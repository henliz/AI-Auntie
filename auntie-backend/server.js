// index.js — Twilio Media Streams ⇄ OpenAI Realtime (Node.js, Express, ws)
// npm i express twilio ws dotenv
// Run: node index.js
// Requires: OPENAI_API_KEY in .env, a Twilio Voice number pointing to /twilio/voice-rt

require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
const VOICE = process.env.OA_VOICE || 'alloy';
const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are a helpful and bubbly AI assistant for phone calls. Keep answers concise. Subtly funny.';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

// Twilio posts form-encoded
const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('Voice Realtime bridge is running.'));

function wsBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').replace(/\s+/g, '');
  const host = req.get('host');
  const raw = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
  return raw.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

// Point your Twilio number's webhook to: https://<public-host>/twilio/voice-rt
app.all('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Google.en-US-Chirp3-HD-Aoede' }, 'Connecting you now.');
  const connect = twiml.connect();
  connect.stream({ url: `${wsBase(req)}/twilio-media` });
  res.type('text/xml').send(twiml.toString());
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';
  if (url.startsWith('/twilio-media')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, request) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  let streamSid = null;
  let callSid = null;

  // Count frames since last commit; Twilio sends ~20ms per 'media' message
  let framesSinceCommit = 0;
  const FRAMES_BEFORE_COMMIT = Number(process.env.FRAMES_BEFORE_COMMIT || 10); // ~200ms
  let twilioStarted = false;

  // OpenAI Realtime WS with subprotocol + beta header
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

  oa.on('open', () => {
    oaOpen = true;
    console.log('[OpenAI] websocket open');

    // Session: telephony-safe µ-law @ 8kHz in/out, server VAD
    oa.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model: MODEL,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: { type: 'audio/pcmu', sample_rate_hz: 8000 },
              turn_detection: { type: 'server_vad' },
            },
            output: {
              format: { type: 'audio/pcmu', sample_rate_hz: 8000 },
              voice: VOICE,
            },
          },
          instructions: SYSTEM_MESSAGE,
        },
      })
    );

    // Optional: greet so caller hears something immediately
    oa.send(
      JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'], // must include text with audio
          instructions: 'Hi! I’m your assistant. I’m listening—go ahead.',
        },
      })
    );
  });

  // OA → Twilio
  oa.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (msg.type === 'response.output_audio.delta' && msg.delta && streamSid) {
      ws.send(
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
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (m.event) {
      case 'start':
        twilioStarted = true;
        streamSid = m.start?.streamSid || streamSid;
        callSid = m.start?.callSid || callSid;
        console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);
        break;

      case 'media':
        if (!twilioStarted || !oaOpen || oa.readyState !== WebSocket.OPEN) break;

        // Forward µ-law base64 as-is to OA
        oa.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: m.media.payload,
          })
        );

        framesSinceCommit++;
        if (framesSinceCommit >= FRAMES_BEFORE_COMMIT) {
          // Ensure >= ~100ms audio in buffer before commit to avoid EMPTY errors
          oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          oa.send(
            JSON.stringify({
              type: 'response.create',
              response: { modalities: ['audio', 'text'] }, // include text
            })
          );
          framesSinceCommit = 0;
        }
        break;

      case 'stop':
        console.log('[Twilio] stop');
        try {
          oa.close();
        } catch {}
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    try {
      oa.close();
    } catch {}
    console.log('[Twilio] media stream closed');
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
  console.log(`Voice TwiML route  → https://<public-host>/twilio/voice-rt`);
  console.log(`Media Stream route → wss://<public-host>/twilio-media`);
});