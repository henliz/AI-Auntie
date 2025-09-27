// server.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify)
// npm i fastify @fastify/formbody @fastify/websocket ws dotenv
// Start: node server.js
// Env: OPENAI_API_KEY=sk-... (Realtime access), optional PUBLIC_BASE_URL=https://<your-domain>

import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

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

const fastify = Fastify({ logger: false });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// quiet health-probe spam
fastify.addHook('onRequest', (req, _reply, done) => {
  if (req.url !== '/health') console.log(`[REQ] ${req.method} ${req.url}`);
  done();
});

// health + root
fastify.get('/health', async (_req, reply) => reply.code(200).type('text/plain').send('OK'));
fastify.get('/', async (_req, reply) => reply.send({ ok: true }));

// Twilio webhook → TwiML that streams to /media-stream
// REPLACE your /incoming-call route with this (Render friendly)
fastify.all('/incoming-call', async (request, reply) => {
  // Use your public Render URL, e.g. https://auntie-voice.onrender.com
  // We force it to wss:// for Twilio Media Streams
  const baseHttps =
    process.env.PUBLIC_BASE_URL   // set this in Render to your https URL
      ? process.env.PUBLIC_BASE_URL.replace(/^ws:/, 'https:').replace(/^wss:/, 'https:')
      : `https://${request.headers.host}`; // fallback: Render's host header
  const wss = baseHttps.replace(/^http:/, 'https:').replace(/^https:/, 'wss:');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to the A. I. voice assistant.</Say>
  <Connect>
    <Stream url="${wss}/media-stream" />
  </Connect>
</Response>`;

  reply.type('text/xml').send(twiml);
});

// Media Stream WS — bridge Twilio <-> OpenAI Realtime
fastify.get('/media-stream', { websocket: true }, (connection /* ws */) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  // ---- state (declare ONCE) ----
  let streamSid = null;
  let callSid = null;
  let oaOpen = false;
  let greeted = false;
  let responseInFlight = false;
  let hasBufferedAudio = false;

  // micro-commit (≈20ms per Twilio frame; 10 → ~200ms)
  let framesSinceCommit = 0;
  const FRAMES_BEFORE_COMMIT = Number(process.env.FRAMES_BEFORE_COMMIT || 10);

  // ---- OpenAI WS ----
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

  // greet once BOTH sides are ready
  const maybeGreet = () => {
    if (!greeted && oaOpen && streamSid) {
      greeted = true;
      safeSendOA({
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
          instructions: "Hi! I'm listening—go ahead.",
        },
      });
    }
  };

  // fallback: keep trying to greet for up to 5s in case of race
  const greeterTick = setInterval(() => {
    if (greeted) clearInterval(greeterTick);
    else maybeGreet();
  }, 250);
  setTimeout(() => clearInterval(greeterTick), 5000);

  // OA socket lifecycle
  oa.on('open', () => {
    oaOpen = true;
    console.log('[OpenAI] websocket open');

    safeSendOA({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: SYSTEM_MESSAGE,
        voice: VOICE,
        input_audio_format: 'g711_ulaw',  // Twilio PCMU μ-law @8k
        output_audio_format: 'g711_ulaw', // return μ-law
        turn_detection: { type: 'server_vad' },
      },
    });

    maybeGreet(); // greet if Twilio already sent 'start'
  });

  oa.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === 'session.updated') console.log('[OpenAI] session.updated ok');
    if (msg.type === 'response.created') responseInFlight = true;
    if (msg.type === 'response.completed' || msg.type === 'response.done') responseInFlight = false;

    if (msg.type === 'input_audio_buffer.speech_stopped') {
      if (hasBufferedAudio) {
        safeSendOA({ type: 'input_audio_buffer.commit' });
        hasBufferedAudio = false;
        if (!responseInFlight) {
          safeSendOA({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
        }
      }
    }

    // model → audio back to Twilio (only if we HAVE streamSid)
    if ((msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') && msg.delta && streamSid) {
      connection.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: msg.delta }, // base64 μ-law; Twilio-ready
      }));
    }

    if (msg.type === 'error') console.error('[OpenAI] error event:', msg);
  });

  oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));
  oa.on('close', () => console.log('[OpenAI] websocket closed'));

  // ---- Twilio → OA ----
  connection.on('message', (raw) => {
    const text = raw.toString();

    // RAW LOGGER: proves we’re receiving Twilio frames (watch for {"event":"start"...})
    if (!greeted && text) console.log('[Twilio] raw:', text.slice(0, 200));

    let m;
    try { m = JSON.parse(text); } catch { return; }

    switch (m.event) {
      case 'start':
        streamSid = m.start?.streamSid || streamSid;   // NOTE: the "||" is important!
        callSid = m.start?.callSid   || callSid;
        console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);
        maybeGreet(); // if OA already open, this will fire greeting now
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

      default:
        break;
    }
  });

  // cleanup
  connection.on('error', (e) => console.error('[WS] Twilio socket error:', e?.message || e));
  connection.on('close', () => {
    try { oa.close(); } catch {}
    console.log('[Twilio] media stream closed');
  });
});


// start server
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
  console.log(`Twilio webhook  → https://<public-host>/incoming-call`);
  console.log(`Media Stream WS → wss://<public-host>/media-stream`);
});
