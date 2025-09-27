// server.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify)
// Build: npm install   |   Start: node server.js
// Env (Render): OPENAI_API_KEY, PUBLIC_BASE_URL=https://auntie-backend.onrender.com
// Optional: OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview (or gpt-realtime), OA_VOICE=alloy, OA_TEMPERATURE=0.8

import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

dotenv.config();

const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY'); process.exit(1);
}

// Model/voice
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'; // 'gpt-4o-realtime-preview' also OK
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

// Auntie persona (non-diagnostic, postpartum-safe)
const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are Auntie — a warm, evidence-informed postpartum support line. Empathy first; 1–3 simple steps; thresholds not diagnoses (e.g., fever ≥38°C). Be concise, kind, and non-judgmental.';

// ---------- Fastify ----------
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Health/root
fastify.get('/health', async (_req, reply) => reply.type('text/plain').send('OK'));
fastify.get('/', async (_req, reply) => reply.send({ ok: true }));

// ---------- Twilio Voice webhook → TwiML with WSS stream ----------
fastify.all('/incoming-call', async (request, reply) => {
  // Prefer PUBLIC_BASE_URL, else use host header
  const rawBase = (process.env.PUBLIC_BASE_URL || `https://${request.headers.host}`).replace(/\/+$/, '');
  // Force wss://, no double slashes
  const wss = rawBase.replace(/^ws:/, 'https:').replace(/^wss:/, 'https:').replace(/^http:/, 'https:').replace(/^https:/, 'wss:');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to Auntie, the A. I. voice assistant.</Say>
  <Connect>
    <Stream url="${wss}/media-stream" />
  </Connect>
</Response>`;

  reply.type('text/xml').send(twiml);
});

// ---------- WebSocket bridge: Twilio <-> OpenAI Realtime ----------
// NOTE: This follows the YouTube structure (works reliably on Twilio)
fastify.register(async (f) => {
  f.get('/media-stream', { websocket: true }, (connection /* ws */, req) => {
    console.log('Client connected (Twilio media stream)');

    // Per-connection state
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    // OpenAI Realtime WS (no Beta header needed for gpt-realtime)
    const oa = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}&temperature=${encodeURIComponent(TEMPERATURE)}`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    // Initialize OpenAI session (matching YouTube sample shapes)
    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          output_modalities: ['audio'],
          audio: {
            input: { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcmu' }, voice: VOICE }
          },
          instructions: SYSTEM_MESSAGE
        }
      };
      oa.send(JSON.stringify(sessionUpdate));
    };

    // Optional: have Auntie speak first (disabled by default)
    const sendInitialConversationItem = () => {
      const initial = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Greet the caller briefly as Auntie and ask how you can help.' }]
        }
      };
      oa.send(JSON.stringify(initial));
      oa.send(JSON.stringify({ type: 'response.create' }));
    };

    // Handle caller interruption when speech starts
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsed = latestMediaTimestamp - responseStartTimestampTwilio;

        if (lastAssistantItem) {
          oa.send(JSON.stringify({
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsed
          }));
        }

        // Ask Twilio to clear any queued audio
        connection.send(JSON.stringify({ event: 'clear', streamSid }));
        // reset
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Send a mark so we know when a response part finishes
    const sendMark = () => {
      if (!streamSid) return;
      connection.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'responsePart' } }));
      markQueue.push('responsePart');
    };

    // ---- OpenAI events ----
    oa.on('open', () => {
      console.log('Connected to OpenAI Realtime');
      setTimeout(initializeSession, 100);
      // Optionally: sendInitialConversationItem();
    });

    oa.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        // Useful logs
        if (['error','response.content.done','rate_limits.updated','response.done','input_audio_buffer.committed','input_audio_buffer.speech_stopped','input_audio_buffer.speech_started','session.created','session.updated'].includes(msg.type)) {
          console.log('[OA]', msg.type);
        }

        // Forward audio deltas to Twilio
        if (msg.type === 'response.output_audio.delta' && msg.delta && streamSid) {
          connection.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: msg.delta } // base64 PCMU
          }));

          // First delta of a response → start elapsed timer
          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
          }

          if (msg.item_id) lastAssistantItem = msg.item_id;
          sendMark();
        }

        if (msg.type === 'input_audio_buffer.speech_started') {
          handleSpeechStartedEvent();
        }
      } catch (e) {
        console.error('OpenAI message parse error:', e, 'raw:', data);
      }
    });

    oa.on('close', () => console.log('OpenAI WS closed'));
    oa.on('error', (e) => console.error('OpenAI WS error:', e?.message || e));

    // ---- Twilio events ----
    connection.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);

        switch (data.event) {
          case 'start':
            streamSid = data.start?.streamSid;
            console.log('Twilio stream started', streamSid);
            // reset timing on new stream
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;

          case 'media':
            latestMediaTimestamp = data.media.timestamp;
            if (oa.readyState === WebSocket.OPEN) {
              oa.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data.media.payload }));
              // Commit frequently so the model can speak back
              oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
              // Kick a response if none is in flight (model will VAD too)
              oa.send(JSON.stringify({ type: 'response.create' }));
            }
            break;

          case 'mark':
            if (markQueue.length > 0) markQueue.shift();
            break;

          case 'stop':
            console.log('Twilio stream stopped');
            if (oa.readyState === WebSocket.OPEN) oa.close();
            break;

          default:
            // other events (e.g., keepalive)
            break;
        }
      } catch (e) {
        console.error('Twilio message parse error:', e, 'raw:', raw);
      }
    });

    connection.on('close', () => {
      if (oa.readyState === WebSocket.OPEN) oa.close();
      console.log('Client disconnected');
    });
  });
});

// ---------- Start ----------
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Listening on ${address}`);
  console.log('Voice webhook  → POST /incoming-call');
  console.log('Media stream   → WSS  /media-stream');
});
