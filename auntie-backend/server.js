// server.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify, Render-safe)
// npm i fastify @fastify/websocket ws dotenv
// Env: OPENAI_API_KEY=sk-...  (Realtime access)
// Optional: PUBLIC_BASE_URL=https://auntie-backend.onrender.com

import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyWs from '@fastify/websocket';

dotenv.config();

const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'; // or 'gpt-4o-realtime-preview'
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are Auntie — a warm, evidence-informed postpartum support line. Empathy first; 1–3 simple steps; thresholds not diagnoses. Be concise, kind, non-judgmental.';

if (!OPENAI_API_KEY) {
  console.error('❌ Missing OPENAI_API_KEY');
  process.exit(1);
}

function makeApp() {
  const fastify = Fastify();
  fastify.register(fastifyWs);

  // Health + root
  fastify.get('/health', async (_r, reply) => reply.type('text/plain').send('OK'));
  fastify.get('/', async (_r, reply) => reply.send({ ok: true }));

  // TwiML webhook (use same host for HTTPS and WSS)
  fastify.all('/incoming-call', async (request, reply) => {
    const rawBase = (process.env.PUBLIC_BASE_URL || `https://${request.headers.host}`).replace(/\/+$/, '');
    const wss = rawBase.replace(/^http:/, 'wss:').replace(/^https:/, 'wss:'); // force WSS

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to Auntie, the A. I. voice assistant.</Say>
  <Connect><Stream url="${wss}/media-stream" /></Connect>
</Response>`;
    reply.type('text/xml').send(twiml);
  });

  // WS bridge
  fastify.register(async (f) => {
    f.get('/media-stream', { websocket: true }, (connection) => {
      console.log('────────────────────────────────────────────────────────');
      console.log('[Twilio] media stream connected');

      // session state (declare once)
      let streamSid = null;
      let latestMediaTimestamp = 0;
      let responseStartTimestampTwilio = null;

      let oaOpen = false;
      let greeted = false;

      // OpenAI WS (use the 'realtime' subprotocol + beta header)
      const oa = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}&temperature=${encodeURIComponent(TEMPERATURE)}`,
        'realtime',
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'OpenAI-Beta': 'realtime=v1',
          },
        }
      );

      const safeSendOA = (obj) => {
        if (oaOpen && oa.readyState === WebSocket.OPEN) oa.send(JSON.stringify(obj));
      };

      // greet exactly once when BOTH sides are ready
      const maybeGreet = () => {
        if (!greeted && oaOpen && streamSid) {
          greeted = true;
          safeSendOA({
            type: 'response.create',
            response: { modalities: ['audio', 'text'], instructions: "Hi! I'm Auntie — I’m listening. Go ahead." },
          });
        }
      };

      // OpenAI events
      oa.on('open', () => {
        oaOpen = true;
        console.log('[OpenAI] websocket open');

        // ✅ GA fields: flat audio formats + voice + VAD + modalities
        safeSendOA({
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            instructions: SYSTEM_MESSAGE,
            voice: VOICE,
            input_audio_format: 'g711_ulaw',   // Twilio PCMU μ-law @8kHz
            output_audio_format: 'g711_ulaw',  // return μ-law
            turn_detection: { type: 'server_vad' },
          },
        });

        maybeGreet(); // greet if Twilio already sent 'start'
      });

      oa.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'session.updated') console.log('[OpenAI] session.updated ok');
        if (msg.type === 'error') console.error('[OpenAI] error:', msg);

        // GA event name for generated audio:
        if ((msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') && msg.delta && streamSid) {
          connection.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: msg.delta }, // base64 μ-law; forward as-is
          }));
          if (!responseStartTimestampTwilio) responseStartTimestampTwilio = latestMediaTimestamp;
        }

        // VAD: when caller stops, commit and ask for a reply
        if (msg.type === 'input_audio_buffer.speech_stopped') {
          safeSendOA({ type: 'input_audio_buffer.commit' });
          safeSendOA({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
          responseStartTimestampTwilio = null;
        }
      });

      oa.on('close', () => console.log('[OpenAI] websocket closed'));
      oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));

      // Twilio events
      connection.on('message', (raw) => {
        let data;
        try { data = JSON.parse(raw); } catch (e) { console.error('Twilio parse error:', e); return; }

        switch (data.event) {
          case 'start':
            streamSid = data.start?.streamSid || streamSid;
            console.log('[Twilio] start:', streamSid);
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            maybeGreet(); // greet now if OA is ready
            break;

          case 'media':
            latestMediaTimestamp = data.media?.timestamp ?? latestMediaTimestamp;
            if (oa.readyState === WebSocket.OPEN && data.media?.payload) {
              safeSendOA({ type: 'input_audio_buffer.append', audio: data.media.payload });
              // With server_vad you can commit periodically or just let VAD decide:
              // small periodic commits reduce latency a bit:
              safeSendOA({ type: 'input_audio_buffer.commit' });
            }
            break;

          case 'stop':
            console.log('[Twilio] stop');
            try { oa.close(); } catch {}
            break;

          // 'mark' etc. can be ignored
        }
      });

      connection.on('close', () => {
        if (oa.readyState === WebSocket.OPEN) oa.close();
        console.log('Client disconnected');
      });
    });
  });

  return fastify;
}

async function start() {
  try {
    const app = makeApp();
    process.on('unhandledRejection', (r) => console.error('UNHANDLED REJECTION', r));
    process.on('uncaughtException', (e) => { console.error('UNCAUGHT EXCEPTION', e); process.exit(1); });

    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Listening on http://0.0.0.0:${PORT}`);
    console.log('Voice webhook  → POST /incoming-call');
    console.log('Media stream   → WSS  /media-stream');
  } catch (err) {
    console.error('Server failed to start:', err);
    process.exit(1);
  }
}

start();
