// index.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify, Render-safe)
// Start: node index.js
// ENV (Render → Environment):
//   OPENAI_API_KEY=sk-...   PUBLIC_BASE_URL=https://auntie-backend.onrender.com
//   (optional) OPENAI_REALTIME_MODEL=gpt-realtime  OA_VOICE=alloy  OA_TEMPERATURE=0.8

import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

dotenv.config();

const { OPENAI_API_KEY } = process.env;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI API key. Please set it in Render → Environment.');
  process.exit(1);
}

const PORT = process.env.PORT || 5050;
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'; // or gpt-4o-realtime-preview
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

// Auntie: empathetic, concise, non-diagnostic
const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are Auntie — a warm, evidence-informed postpartum support line. Empathy first; offer 1–3 simple, safe steps; never diagnose; escalate to emergency services if there is imminent risk. Be brief, kind, and non-judgmental.';

const LOG_EVENT_TYPES = [
  'session.created','session.updated',
  'input_audio_buffer.speech_started','input_audio_buffer.speech_stopped','input_audio_buffer.committed',
  'response.created','response.done','rate_limits.updated','error'
];

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Root/health
fastify.get('/', async (_req, reply) => reply.send({ ok: true }));
fastify.get('/health', async (_req, reply) => reply.type('text/plain').send('OK'));

// Twilio webhook → return TwiML that streams to /media-stream (Render-safe WSS)
fastify.all('/incoming-call', async (request, reply) => {
  const rawBase = (process.env.PUBLIC_BASE_URL || `https://${request.headers.host}`).replace(/\/+$/, '');
  const wss = rawBase
    .replace(/^ws:/, 'https:')
    .replace(/^wss:/, 'https:')
    .replace(/^http:/, 'https:')
    .replace(/^https:/, 'wss:');

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to Auntie, the A. I. voice assistant.</Say>
  <Connect>
    <Stream url="${wss}/media-stream" />
  </Connect>
</Response>`;

  reply.type('text/xml').send(twimlResponse);
});

// WebSocket: Twilio Media Stream <-> OpenAI Realtime
fastify.register(async (f) => {
  f.get('/media-stream', { websocket: true }, (connection /* ws */) => {
    console.log('Client connected (Twilio media stream)');

    // Per-connection state
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    // OpenAI Realtime WS
    const oa = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}&temperature=${encodeURIComponent(TEMPERATURE)}`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    // Initialize the session (μ-law PCMU in/out + server VAD)
    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: MODEL,
          output_modalities: ['audio'],
          audio: {
            input:  { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcmu' }, voice: VOICE }
          },
          instructions: SYSTEM_MESSAGE
        }
      };
      oa.send(JSON.stringify(sessionUpdate));
    };

    // If caller starts talking while assistant is speaking, truncate playback
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
        if (streamSid) connection.send(JSON.stringify({ event: 'clear', streamSid }));
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

    // OpenAI events
    oa.on('open', () => {
      console.log('Connected to the OpenAI Realtime API');
      setTimeout(initializeSession, 100);
    });

    oa.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch (e) {
        console.error('OpenAI message parse error:', e, 'raw:', data);
        return;
      }

      if (LOG_EVENT_TYPES.includes(msg.type)) console.log('[OA]', msg.type, msg.type === 'error' ? msg : '');

      // Model → Twilio audio stream (μ-law base64)
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

      // Turn-taking: when caller stops speaking → commit and ask for one reply
      if (msg.type === 'input_audio_buffer.speech_stopped') {
        oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        oa.send(JSON.stringify({ type: 'response.create' }));
        responseStartTimestampTwilio = null;
      }

      if (msg.type === 'input_audio_buffer.speech_started') {
        handleSpeechStartedEvent();
      }
    });

    oa.on('error', (e) => console.error('OpenAI WS error:', e?.message || e));
    oa.on('close', () => console.log('Disconnected from the OpenAI Realtime API'));

    // Twilio → OpenAI
    connection.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw); } catch (e) {
        console.error('Twilio message parse error:', e, 'raw:', raw);
        return;
      }

      switch (data.event) {
        case 'start':
          streamSid = data.start?.streamSid;
          console.log('Incoming stream has started', streamSid);
          responseStartTimestampTwilio = null;
          latestMediaTimestamp = 0;
          break;

        case 'media':
          latestMediaTimestamp = data.media?.timestamp ?? latestMediaTimestamp;
          if (oa.readyState === WebSocket.OPEN && data.media?.payload) {
            // Append caller audio and commit frequently so VAD sees fresh chunks
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

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
  console.log('Voice webhook  → POST /incoming-call');
  console.log('Media stream   → WSS  /media-stream');
});
