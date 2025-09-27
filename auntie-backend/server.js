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

// Model + voice
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are a helpful, bubbly phone assistant. Keep answers concise, warm, and lightly humorous.';

const fastify = Fastify({ logger: false });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Quiet the health probe spam
fastify.addHook('onRequest', (req, _reply, done) => {
  if (req.url !== '/health') console.log(`[REQ] ${req.method} ${req.url}`);
  done();
});

// Health + root
fastify.get('/health', async (_req, reply) => reply.code(200).type('text/plain').send('OK'));
fastify.get('/', async (_req, reply) => reply.send({ ok: true }));

// Twilio webhook → returns TwiML that connects Media Stream to /media-stream
fastify.all('/incoming-call', async (request, reply) => {
  const wsBase = (req) => {
    const proto = (req.headers['x-forwarded-proto'] || 'https').replace(/\s+/g, '');
    const host = req.headers.host;
    const base = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
    return base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  };

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to the A. I. voice assistant.</Say>
  <Connect><Stream url="${wsBase(request)}/media-stream" /></Connect>
</Response>`;

  reply.type('text/xml').send(twiml);
});

// Media Stream WS endpoint — bridges Twilio <-> OpenAI Realtime
fastify.get('/media-stream', { websocket: true }, (connection /* ws */) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  let streamSid = null;
  let callSid = null;

  // Optional: micro-commit to keep buffers small (~20ms per Twilio media frame)
  let hasBufferedAudio = false;
  let framesSinceCommit = 0;
  const FRAMES_BEFORE_COMMIT = Number(process.env.FRAMES_BEFORE_COMMIT || 10); // ~200ms

  // OpenAI Realtime WS with proper handshake
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

  let oaOpen = false;
  let responseInFlight = false;
  let streamSid = null;
  let greeted = false;

  // Fire the greeting once both OA is open and we have a streamSid
  maybeGreet();

  const safeSendOA = (obj) => {
    if (oaOpen && oa.readyState === WebSocket.OPEN) oa.send(JSON.stringify(obj));
  };

  // OpenAI socket open → configure session (✅ GA fields; no legacy)
  oa.on('open', () => {
    oaOpen = true;
    console.log('[OpenAI] websocket open');

    safeSendOA({
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        instructions: SYSTEM_MESSAGE,
        voice: VOICE,
        input_audio_format: 'g711_ulaw',   // Twilio PCMU μ-law @ 8kHz
        output_audio_format: 'g711_ulaw',  // Return PCMU μ-law
        turn_detection: { type: 'server_vad' },
      },
    });
    // NOTE: Do NOT greet here—wait until we have streamSid from Twilio 'start'
  });

  // Handle OpenAI events
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

    // ✅ GA name is 'response.audio.delta'; keep backward alias too
    if ((msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') && msg.delta && streamSid) {
      connection.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: msg.delta }, // already base64 μ-law; forward as-is
      }));
    }

    if (msg.type === 'error') console.error('[OpenAI] error event:', msg);
  });

  oa.on('close', () => console.log('[OpenAI] websocket closed'));
  oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));

  // Twilio → OA
  connection.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    // debug: show first few event types
    if (m?.event && (m.event === 'start' || m.event === 'media')) {
      // Uncomment if you want to see media spam:
      // console.log('[Twilio] event:', m.event);
    }

    switch (m.event) {
      case 'start':
        streamSid = m.start?.streamSid || streamSid;
        callSid = m.start?.callSid || callSid;
        console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);

        // Greet if OA is ready; if not, OA's 'open' will trigger it
        maybeGreet();

        break;

      case 'media':
        if (!oaOpen || oa.readyState !== WebSocket.OPEN) break;
        if (m.media?.payload) {
          safeSendOA({ type: 'input_audio_buffer.append', audio: m.media.payload });
          hasBufferedAudio = true;

          // Optional micro-commit for snappier turns
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
        // ignore 'mark' and others
        break;
    }
  });

  connection.on('error', (e) => console.error('[WS] Twilio socket error:', e?.message || e));
  connection.on('close', () => {
    try { oa.close(); } catch {}
    console.log('[Twilio] media stream closed');
  });
});

// Start server
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
  console.log(`Twilio webhook  → https://<public-host>/incoming-call`);
  console.log(`Media Stream WS → wss://<public-host>/media-stream`);
});
