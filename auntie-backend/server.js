// server.js — SMS + Voice (Media Stream Step 1)
// Run: node server.js   (PORT from env or 3000)

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

const { formatReply } = require('./composer');
const ai = require('./ai');
const sf = require('./snowflake');
const db = require('./mongo');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// ---- Health & root
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));

// ========================= SMS WEBHOOK =========================
app.all('/twilio/sms', async (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();

  try {
    const context = await db.getContext(from);
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: body, context });

    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
    }
    await db.saveMessage({ phone: from, intent, topic, message: body });

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(formatReply({ bodyText: reply_text, resources }));
    return res.type('text/xml').send(twiml.toString());
  } catch (e) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Auntie glitched—try again in a minute. If it feels urgent, call local emergency. 🌸");
    return res.type('text/xml').send(twiml.toString());
  }
});

// ========================= VOICE (Media Stream) =========================
// New entrypoint for Realtime: say hello, then stream inbound audio to /twilio-media
function wsStreamUrl(req) {
  const base = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  // convert https -> wss (and http -> ws) for WebSocket
  return base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/twilio-media';
}

app.post('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  // Short hello so callers know it's connected
  twiml.say({ voice: 'Polly.Kendra' },
    "Hi love, I’m Auntie. I’m listening now.");

  // Stream the caller's audio to our WS endpoint
  const connect = twiml.connect();
  connect.stream({
    url: wsStreamUrl(req),
    track: 'inbound_audio'
    // You can also set statusCallback / events if you want
    // statusCallback: 'https://example.com/twilio/stream-status',
    // statusCallbackEvent: 'start completed media stop'
  });

  return res.type('text/xml').send(twiml.toString());
});

// ========================= WEBSOCKET HANDLER =========================
// We upgrade the HTTP server to accept WebSocket connections at /twilio-media.
// Twilio will send JSON messages: {event:'start'|'media'|'stop', ...}
// media.payload is base64 mu-law @ 8kHz; we just count frames here (Step 1).

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
  let frames = 0;
  let streamSid = 'unknown';
  let callSid = 'unknown';

  console.log('[WS] Twilio media stream connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      switch (msg.event) {
        case 'start':
          streamSid = msg.start?.streamSid || streamSid;
          callSid = msg.start?.callSid || callSid;
          console.log(`[WS] start: callSid=${callSid} streamSid=${streamSid} track=${msg.start?.track}`);
          break;
        case 'media':
          frames++;
          // msg.media.payload is base64 mu-law audio at 8kHz
          // We'll transcode/forward to OpenAI Realtime in Step 2
          if (frames % 50 === 0) {
            console.log(`[WS] media frames: ${frames}`);
          }
          break;
        case 'stop':
          console.log(`[WS] stop: callSid=${callSid} streamSid=${streamSid} totalFrames=${frames}`);
          break;
        default:
          // keep-alives, marks, etc.
          break;
      }
    } catch (e) {
      console.log('[WS] non-JSON frame received');
    }
  });

  ws.on('close', () => {
    console.log('[WS] Twilio media stream closed');
  });
});

// ========================= START SERVER =========================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Auntie on :${PORT} (WS ready at /twilio-media)`);
});
