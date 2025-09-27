// server.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify)
// Build: npm install   |   Start: node server.js
// Env (Render): OPENAI_API_KEY, OPENAI_REALTIME_MODEL, PUBLIC_BASE_URL, OA_VOICE, OA_TEMPERATURE

import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// ---------- Config ----------
const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment.');
  process.exit(1);
}
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);
const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are a helpful, bubbly phone assistant. Keep answers concise, warm, and lightly humorous.';

// ---------- Fastify app ----------
const fastify = Fastify({ logger: false });
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

// quiet health-probe spam
fastify.addHook('onRequest', (req, _reply, done) => {
  if (req.url !== '/health') console.log(`[REQ] ${req.method} ${req.url}`);
  done();
});

// health + root
fastify.get('/health', async (_req, reply) => reply.code(200).type('text/plain').send('OK'));
fastify.get('/', async (_req, reply) => reply.send({ ok: true }));

// ---------- Voice webhook: return TwiML with a WSS media stream ----------
fastify.all('/incoming-call', async (request, reply) => {
  // PUBLIC_BASE_URL example: https://auntie-backend.onrender.com
  const rawBase = process.env.PUBLIC_BASE_URL || `https://${request.headers.host}`;
  // normalize: no trailing slash, force wss://
  const baseNoSlash = rawBase.replace(/\/+$/, '');
  const wss = baseNoSlash
    .replace(/^ws:/, 'https:')
    .replace(/^wss:/, 'https:')
    .replace(/^http:/, 'https:')
    .replace(/^https:/, 'wss:');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to the A. I. voice assistant.</Say>
  <Connect>
    <Stream url="${wss}/media-stream" />
  </Connect>
</Response>`;

  reply.type('text/xml').send(twiml);
});

// ---------- Media Stream WS: Twilio <-> OpenAI bridge ----------
fastify.get('/media-stream', { websocket: true }, (connection) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  // state
  let streamSid = null;
  let callSid = null;
  let oaOpen = false;
  let greeted = false;
  let responseInFlight = false;
  let hasBufferedAudio = false;

  // ~200ms micro-commit cadence
  let framesSinceCommit = 0;
  const FRAMES_BEFORE_COMMIT = Number(process.env.FRAMES_BEFORE_COMMIT || 10);

  // OpenAI realtime WS
  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}&temperature=${encodeURIComponent(TEMPERATURE)}`,
    'realtime',
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } }
  );

  const safeSendOA = (obj) => {
    if (oaOpen && oa.readyState === WebSocket.OPEN) oa.send(JSON.stringify(obj));
  };

  // greet once BOTH Twilio started (streamSid) and OA is open
  const maybeGreet = () => {
    if (!greeted && oaOpen && streamSid) {
      greeted = true;
      safeSendOA({
        type: 'response.create',
        response: { modalities: ['audio', 'text'], instructions: "Hi! I'm listening—go ahead." },
      });
    }
  };
  // race fallback
  const greeterTick = setInterval(() => { if (greeted) clearInterval(greeterTick); else maybeGreet(); }, 250);
  setTimeout(() => clearInterval(greeterTick), 5000);

  // OA lifecycle
  oa.on('open', () => {
    oaOpen = true;
    console.log('[OpenAI] websocket open');
    safeSendOA({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: SYSTEM_MESSAGE,
        voice: VOICE,
        input_audio_format: 'g711_ulaw',   // Twilio μ-law @8kHz
        output_audio_format: 'g711_ulaw',
        turn_detection: { type: 'server_vad' },
      },
    });
    maybeGreet();
  });

  oa.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === 'session.updated') console.log('[OpenAI] session.updated ok');
    if (msg.type === 'response.created') responseInFlight = true;
    if (msg.type === 'response.completed' || msg.type === 'response.done') responseInFlight = false;

    if (msg.type === 'input_audio_buffer.speech_stopped') {
      if (hasBufferedAudio) {
        safeSendOA({ type: 'input_audio_buffer.commit' });
        hasBufferedAudio = false;
        if (!responseInFlight) safeSendOA({ type: 'response.create', response: { modalities: ['audio','text'] } });
      }
    }

    // OA -> Twilio audio (needs streamSid from Twilio 'start')
    if ((msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') && msg.delta && streamSid) {
      connection.socket.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: msg.delta }, // base64 PCMU μ-law
      }));
    }

    if (msg.type === 'error') console.error('[OpenAI] error event:', msg);
  });

  oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));
  oa.on('close', () => console.log('[OpenAI] websocket closed'));

  // Twilio -> OA (IMPORTANT: use connection.socket)
  connection.socket.on('message', (raw) => {
    const text = raw.toString();
    if (!greeted && text) console.log('[Twilio] raw:', text.slice(0, 200));

    let m; try { m = JSON.parse(text); } catch { return; }
    switch (m.event) {
      case 'start':
        streamSid = m.start?.streamSid || streamSid;
        callSid   = m.start?.callSid   || callSid;
        console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);
        maybeGreet();
        break;

      case 'media':
        if (!oaOpen || oa.readyState !== WebSocket.OPEN) break;
        if (m.media?.payload) {
          safeSendOA({ type: 'input_audio_buffer.append', audio: m.media.payload });
          hasBufferedAudio = true;
          framesSinceCommit++;
          if (framesSinceCommit >= FRAMES_BEFORE_COMMIT) {
            safeSendOA({ type: 'input_audio_buffer.commit' });
            framesSinceCommit = 0;
          }
        }
        break;

      case 'stop':
        console.log('[Twilio] stop');
        try { oa.close(); } catch {}
        break;
    }
  });

  connection.socket.on('error', (e) => console.error('[WS] Twilio socket error:', e?.message || e));
  connection.socket.on('close', () => { try { oa.close(); } catch {} console.log('[Twilio] media stream closed'); });
});

// ---------- Start server ----------
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`Server listening on ${address}`);
  console.log(`Twilio webhook  → https://<public-host>/incoming-call`);
  console.log(`Media Stream WS → wss://<public-host>/media-stream`);
});
