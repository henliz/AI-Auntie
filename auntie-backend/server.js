// index.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify)
// npm i fastify @fastify/formbody @fastify/websocket ws dotenv
// Run: node index.js
// Env: OPENAI_API_KEY=sk-...  (must have Realtime access)
// Twilio "A CALL COMES IN" → https://<public-host>/incoming-call
// <Stream> url → wss://<public-host>/media-stream

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

// ───────────────────────────────────────────────────────────────────────────────

const fastify = Fastify({ logger: false });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Health
// Log requests so you can SEE the health probe hitting you
fastify.addHook('onRequest', (req, _reply, done) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  done();
});

// Health check: super fast, always-200
fastify.get('/health', async (_req, reply) => {
  reply.code(200).type('text/plain').send('OK');
});

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
  <Connect><Stream url="wss://auntie-backend.onrender.com/media-stream" /></Connect>
</Response>`;

  reply.type('text/xml').send(twiml);
});

// Media Stream WS endpoint — bridges Twilio <-> OpenAI Realtime
fastify.get('/media-stream', { websocket: true }, (connection /* ws */, req) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  let streamSid = null;
  let callSid = null;

  // Track whether we've buffered any audio since the last commit
  let hasBufferedAudio = false;

  // Optional micro-commit to limit buffer growth (~20ms per Twilio 'media' frame)
  let framesSinceCommit = 0;
  const FRAMES_BEFORE_COMMIT = Number(process.env.FRAMES_BEFORE_COMMIT || 10); // ~200ms

  // OpenAI Realtime WS (v1) with proper subprotocol + beta header
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

  const safeSendOA = (obj) => {
    if (oaOpen && oa.readyState === WebSocket.OPEN) {
      oa.send(JSON.stringify(obj));
    }
  };

  // When OA socket opens, configure session for telephony-safe μ-law @ 8kHz
  oa.on('open', () => {
    oaOpen = true;
    console.log('[OpenAI] websocket open');

    // session.update: g711 μ-law in/out + server VAD + system instructions
    safeSendOA({
      type: 'session.update',
      session: {
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'g711_ulaw', sample_rate_hz: 8000 },
            turn_detection: { type: 'server_vad' },
          },
          output: {
            format: { type: 'g711_ulaw', sample_rate_hz: 8000 },
            voice: VOICE,
          },
        },
        instructions: SYSTEM_MESSAGE,
      },
    });

    // Optional: greet so caller hears something immediately
    safeSendOA({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
        instructions: "Hi! I'm listening—go ahead.",
      },
    });
  });

  // OA → handle events (audio deltas, VAD, lifecycle)
  oa.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    if (msg.type === 'session.updated') {
      console.log('[OpenAI] session.updated ok');
    }

    if (msg.type === 'response.created') responseInFlight = true;
    if (msg.type === 'response.completed' || msg.type === 'response.done') responseInFlight = false;

    if (msg.type === 'input_audio_buffer.speech_stopped') {
      // Caller stopped talking → commit ONLY if we actually buffered audio
      if (hasBufferedAudio) {
        safeSendOA({ type: 'input_audio_buffer.commit' });
        hasBufferedAudio = false;
        if (!responseInFlight) {
          safeSendOA({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
        }
      }
    }

    if (msg.type === 'response.output_audio.delta' && msg.delta && streamSid) {
      // Forward base64 μ-law audio straight to Twilio (do NOT re-encode)
      connection.send(
        JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: msg.delta },
        })
      );
    }

    if (msg.type === 'error') {
      console.error('[OpenAI] error event:', msg);
    }
  });

  oa.on('close', () => console.log('[OpenAI] websocket closed'));
  oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));

  // Twilio → OA
  connection.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (m.event) {
      case 'start':
        streamSid = m.start?.streamSid || streamSid;
        callSid = m.start?.callSid || callSid;
        console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);
        break;

      case 'media':
        if (!oaOpen || oa.readyState !== WebSocket.OPEN) break;
        if (m.media?.payload) {
          // Append μ-law audio frames from Twilio to OA buffer
          safeSendOA({ type: 'input_audio_buffer.append', audio: m.media.payload });
          hasBufferedAudio = true;

          // Optional micro-commit to keep latency snappy; safe to remove
          framesSinceCommit++;
          if (framesSinceCommit >= FRAMES_BEFORE_COMMIT) {
            safeSendOA({ type: 'input_audio_buffer.commit' });
            framesSinceCommit = 0;
            // Do not request a response here; rely on VAD or longer user pauses
          }
        }
        break;

      case 'stop':
        console.log('[Twilio] stop');
        try {
          oa.close();
        } catch {}
        break;

      default:
        // Other Twilio events (e.g., 'mark') can be ignored
        break;
    }
  });

  // Cleanup when caller hangs up
  connection.on('close', () => {
    try {
      oa.close();
    } catch {}
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
