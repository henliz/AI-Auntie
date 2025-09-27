// index.js — Twilio Media Streams ⇄ OpenAI Realtime (Node.js, Express, ws)
// npm i express twilio ws dotenv
// Run: node index.js
// Requires: OPENAI_API_KEY in .env, a Twilio Voice number pointing to /twilio/voice-rt
//
// Notes:
// - Uses proper OpenAI Realtime WS handshake (subprotocol 'realtime' + 'OpenAI-Beta' header).
// - Telephony-safe audio (G.711 µ-law @8k) in/out via 'audio/pcmu'.
// - Manual commit + response.create every ~500ms to ensure the model speaks across accounts.
// - Proxy-safe Stream URL generation for ngrok/Render/etc.
//
// (c) you — MIT-style; adapt freely.

require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

// ---------- sanity envs ----------
const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

// Configurables
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
const VOICE = process.env.OA_VOICE || 'alloy'; // try 'aria', 'alloy', etc.
const SYSTEM_MESSAGE = process.env.SYSTEM_MESSAGE || (
  'You are a helpful and bubbly AI assistant who loves to chat about anything the user is ' +
  'interested in and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, ' +
  'and rickrolling — subtly. Keep answers concise for phone. If there is any risk of harm or a medical ' +
  'emergency, calmly recommend professional/urgent care.'
);
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// Health & root
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('Voice Realtime bridge is running.'));

// Helper: build a proxy-safe WS base (ngrok/Render/etc.)
function wsBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').replace(/\s+/g, '');
  const host = req.get('host');
  const raw = process.env.PUBLIC_BASE_URL || `${proto}://${host}`;
  return raw.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

// ---------- Twilio: Voice webhook that returns TwiML to open the media stream ----------
// Point your Twilio number's "A CALL COMES IN" webhook to: https://<public-host>/twilio/voice-rt
app.all('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  // Optional greeting (keep it snappy)
  twiml.say({ voice: 'Google.en-US-Chirp3-HD-Aoede' }, 'Connecting you now.');
  const connect = twiml.connect();
  connect.stream({ url: `${wsBase(req)}/twilio-media` });
  res.type('text/xml').send(twiml.toString());
});

// ---------- HTTP server & WS upgrade handling ----------
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

// ---------- WS bridge: Twilio ⇄ OpenAI Realtime ----------
wss.on('connection', (ws, request) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  let streamSid = null;
  let callSid = null;
  let frameCount = 0;
  const FRAMES_PER_COMMIT = Number(process.env.FRAMES_PER_COMMIT || 25); // ~500ms (@20ms/frame)

  // Proper OA Realtime WS handshake: subprotocol + beta header
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

    // Session configuration: µ-law in/out, server VAD, audio modality
    oa.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: MODEL,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            turn_detection: { type: 'server_vad' },
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: VOICE,
          },
        },
        instructions: SYSTEM_MESSAGE,
      },
    }));

    // Optional: have the model speak first so callers hear something immediately
    oa.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['audio'],
        instructions: 'Hi! I’m your assistant. I’m listening—go ahead.',
      },
    }));
  });

  // OpenAI → Twilio: stream µ-law base64 back to the caller
  oa.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // Uncomment to see events
    // if (msg?.type) console.log('[OpenAI]', msg.type);

    if (msg.type === 'response.output_audio.delta' && msg.delta) {
      if (!streamSid) return; // wait for Twilio 'start'
      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: msg.delta },
      }));
    }

    if (msg.type === 'error') {
      console.error('[OpenAI] error event:', msg);
    }
  });

  oa.on('close', () => console.log('[OpenAI] websocket closed'));
  oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));

  // Twilio → OpenAI: forward caller audio; commit often so OA replies promptly
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    switch (m.event) {
      case 'start':
        streamSid = m.start?.streamSid || streamSid;
        callSid = m.start?.callSid || callSid;
        console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);
        break;

      case 'media':
        if (oaOpen && oa.readyState === WebSocket.OPEN) {
          // Forward Twilio’s µ-law base64 straight into OA input buffer
          oa.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: m.media.payload,
          }));

          frameCount++;
          if (frameCount % FRAMES_PER_COMMIT === 0) {
            // Nudge generation cross-account (compatible with server VAD)
            oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            oa.send(JSON.stringify({
              type: 'response.create',
              response: { modalities: ['audio'] },
            }));
          }
        }
        break;

      case 'stop':
        console.log('[Twilio] stop');
        try { oa.close(); } catch {}
        break;

      default:
        // could log 'mark' and other events if needed
        break;
    }
  });

  ws.on('close', () => {
    try { oa.close(); } catch {}
    console.log('[Twilio] media stream closed');
  });
});

// ---------- start ----------
server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
  console.log(`Voice TwiML route  → https://<public-host>/twilio/voice-rt`);
  console.log(`Media Stream route → wss://<public-host>/twilio-media`);
});
