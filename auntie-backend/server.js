// server.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify)
// npm i fastify @fastify/websocket ws dotenv
// Start: node server.js
// Env: OPENAI_API_KEY=sk-...  (Realtime access)
// Optional: PUBLIC_BASE_URL=https://auntie-backend.onrender.com

import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime'; // or 'gpt-4o-realtime-preview'
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are Auntie — a warm, evidence-informed postpartum support line. Empathy first; 1–3 simple steps; thresholds not diagnoses. Be concise, kind, non-judgmental.';

if (!OPENAI_API_KEY) {
  console.error('❌ Missing OPENAI_API_KEY');
  process.exit(1);
}

const app = Fastify({ logger: false });
app.register(fastifyWs);

// quiet health spam
app.addHook('onRequest', (req, _reply, done) => {
  if (req.url !== '/health') console.log(`[REQ] ${req.method} ${req.url}`);
  done();
});

// health + root
app.get('/health', async (_r, reply) => reply.type('text/plain').send('OK'));
app.get('/', async (_r, reply) => reply.send({ ok: true }));

// TwiML webhook — use same host for HTTPS and WSS
app.all('/incoming-call', async (request, reply) => {
  const base = (process.env.PUBLIC_BASE_URL || `https://${request.headers.host}`).replace(/\/+$/, '');
  const wssBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:'); // force WSS
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to Auntie, the A. I. voice assistant.</Say>
  <Connect><Stream url="${wssBase}/media-stream" /></Connect>
</Response>`;
  reply.type('text/xml').send(twiml);
});

// Media Stream bridge
app.get('/media-stream', { websocket: true }, (ws /* WebSocket */) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  // state (declare once)
  let streamSid = null;
  let callSid = null;
  let oaOpen = false;
  let greeted = false;

  // OpenAI Realtime WS
  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}&temperature=${encodeURIComponent(TEMPERATURE)}`,
    'realtime',
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  const safeSendOA = (obj) => {
    if (oaOpen && oa.readyState === WebSocket.OPEN) {
      oa.send(JSON.stringify(obj));
    }
  };

  // greet once both sides are ready
  const maybeGreet = () => {
    if (!greeted && oaOpen && streamSid) {
      greeted = true;
      safeSendOA({
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
          instructions: "Hi! I'm Auntie — I’m listening. Go ahead.",
        },
      });
    }
  };

  // OpenAI socket
  oa.on('open', () => {
    oaOpen = true;
    console.log('[OpenAI] websocket open');

    // correct GA fields
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

    maybeGreet(); // in case Twilio 'start' already arrived
  });

  oa.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf8')); } catch { return; }

    if (msg.type === 'session.updated') console.log('[OpenAI] session.updated ok');
    if (msg.type === 'error') console.error('[OpenAI] error:', msg);

    // model → audio back to Twilio
    if ((msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') && msg.delta && streamSid) {
      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: msg.delta }, // base64 μ-law
      }));
    }

    // VAD: caller paused → commit + ask for reply
    if (msg.type === 'input_audio_buffer.speech_stopped') {
      safeSendOA({ type: 'input_audio_buffer.commit' });
      safeSendOA({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
    }
  });

  oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));
  oa.on('close', (code, reason) => console.log('[OpenAI] websocket closed', code, reason?.toString?.()));

  // Twilio → OA (robust parse)
  ws.on('message', (raw) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    let m;
    try { m = JSON.parse(text); } catch (e) { console.error('Twilio parse error:', e?.message || e); return; }

    if (m.event === 'start') {
      streamSid = m.start?.streamSid || streamSid;
      callSid = m.start?.callSid || callSid;
      console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);
      maybeGreet();
    } else if (m.event === 'media') {
      if (m.media?.payload && oa.readyState === WebSocket.OPEN) {
        safeSendOA({ type: 'input_audio_buffer.append', audio: m.media.payload });
        // rely on server VAD to commit; no need to commit every frame
      }
    } else if (m.event === 'stop') {
      console.log('[Twilio] stop');
      try { oa.close(); } catch {}
    }
  });

  ws.on('close', (code, reason) => {
    try { oa.close(); } catch {}
    console.log('[Twilio] media stream closed', code, reason?.toString?.());
  });
});

// start
app.listen({ port: PORT, host: '0.0.0.0' }, (err, addr) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${addr}`);
  console.log('Twilio webhook  → POST /incoming-call');
  console.log('Media Stream WS → WSS  /media-stream');
});
