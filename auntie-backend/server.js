// server.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify, Render-ready)
// Build: npm install    |   Start: node server.js
// Env: OPENAI_API_KEY=... , PUBLIC_BASE_URL=https://auntie-backend.onrender.com
// Optional: OPENAI_REALTIME_MODEL=gpt-realtime (default) or gpt-4o-realtime-preview
//           OA_VOICE=alloy , OA_TEMPERATURE=0.8

import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

dotenv.config();

// ---------- Config ----------
const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY'); process.exit(1);
}

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'; // keep this default for schema
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

// Auntie persona: empathetic, non-diagnostic
const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are Auntie — a warm, evidence-informed postpartum support line. Empathy first; 1–3 simple steps; thresholds not diagnoses. Be concise, kind, non-judgmental.';

// ---------- Fastify ----------
const fastify = Fastify();
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

// Health + root
fastify.get('/health', async (_r, reply) => reply.type('text/plain').send('OK'));
fastify.get('/', async (_r, reply) => reply.send({ ok: true }));

// ---------- Twilio webhook: return TwiML with secure WSS stream ----------
fastify.all('/incoming-call', async (request, reply) => {
  // base: PUBLIC_BASE_URL or host header
  const rawBase = (process.env.PUBLIC_BASE_URL || `https://${request.headers.host}`).replace(/\/+$/, '');
  // normalize scheme to wss:// (no double slashes)
  const wss = rawBase
    .replace(/^ws:/, 'https:')
    .replace(/^wss:/, 'https:')
    .replace(/^http:/, 'https:')
    .replace(/^https:/, 'wss:');

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

    // --- Initialize session (YouTube-proven schema; μ-law PCMU in/out) ---
    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          output_modalities: ['audio'],
          audio: {
            input:  { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcmu' }, voice: VOICE },
          },
          instructions: SYSTEM_MESSAGE,
        },
      };
      oa.send(JSON.stringify(sessionUpdate));
    };

    // optional: make Auntie speak first (disabled)
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

    // barge-in handler (truncate assistant if caller starts talking)
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
        // ask Twilio to clear any queued audio
        if (streamSid) connection.send(JSON.stringify({ event: 'clear', streamSid }));
        // reset
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    const sendMark = () => {
      if (!streamSid) return;
      connection.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'responsePart' } }));
      markQueue.push('responsePart');
    };

    // ---- OpenAI events ----
    oa.on('open', () => {
      console.log('Connected to OpenAI Realtime');
      setTimeout(initializeSession, 100);
      // sendInitialConversationItem(); // (enable if you want Auntie to greet first)
    });

    oa.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) {
        console.error('OpenAI message parse error:', e, 'raw:', data);
        return;
      }

      if (msg.type === 'error') {
        console.error('[OA ERROR]', msg.error?.code || '', msg.error?.message || '', msg);
      }

      const LOG_EVENT_TYPES = [
        'session.created','session.updated',
        'input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','input_audio_buffer.committed',
        'response.created','response.done','rate_limits.updated'
      ];
      if (LOG_EVENT_TYPES.includes(msg.type)) console.log('[OA]', msg.type);

      // Model → Twilio audio (μ-law base64)
      if (msg.type === 'response.output_audio.delta' && msg.delta && streamSid) {
        connection.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: msg.delta }
        }));
        if (!responseStartTimestampTwilio) responseStartTimestampTwilio = latestMediaTimestamp;
        if (msg.item_id) lastAssistantItem = msg.item_id;
        sendMark();
      }

      // Caller stopped talking → commit once, then ask for a single reply
      if (msg.type === 'input_audio_buffer.speech_stopped') {
        oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        oa.send(JSON.stringify({ type: 'response.create' }));
        responseStartTimestampTwilio = null;
      }

      if (msg.type === 'input_audio_buffer.speech_started') {
        handleSpeechStartedEvent();
      }
    });

    oa.on('close', () => console.log('OpenAI WS closed'));
    oa.on('error', (e) => console.error('OpenAI WS error:', e?.message || e));

    // ---- Twilio events ----
    connection.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch (e) {
        console.error('Twilio message parse error:', e, 'raw:', raw);
        return;
      }

      switch (data.event) {
        case 'start':
          streamSid = data.start?.streamSid;
          console.log('Twilio stream started', streamSid);
          responseStartTimestampTwilio = null;
          latestMediaTimestamp = 0;
          break;

        case 'media':
          latestMediaTimestamp = data.media?.timestamp ?? latestMediaTimestamp;
          if (oa.readyState === WebSocket.OPEN && data.media?.payload) {
            // append audio and commit frequently so VAD sees new chunks
            oa.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data.media.payload }));
            oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            // DO NOT call response.create here — wait for speech_stopped
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
          break;
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
