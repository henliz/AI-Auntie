// server.js — SMS + Voice (Twilio Media Streams ⇄ OpenAI Realtime, true bidirectional μ-law)
require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

// ---- Your modules (stubs or real)
const { formatReply } = require('./composer');
const ai = require('./ai');
const sf = require('./snowflake');
const db = require('./mongo');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// ---------- Basic routes ----------
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));

// ---------- SMS Webhook ----------
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
  } catch {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Auntie glitched—try again in a minute. If it feels urgent, call local emergency. 🌸");
    return res.type('text/xml').send(twiml.toString());
  }
});

// ---------- Voice (Media Stream entry; NO Polly/Play) ----------
function wsStreamUrl(req) {
  const base = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  return base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/twilio-media';
}

app.all('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  // Twilio opens a bidirectional WS; we will send audio back on the same socket
  connect.stream({ url: wsStreamUrl(req) });
  return res.type('text/xml').send(twiml.toString());
});

// ---------- HTTP server + WS upgrade ----------
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

// ---------- WS bridge: Twilio ⇄ OpenAI Realtime (μ-law passthrough) ----------
wss.on('connection', (ws, request) => {
  let streamSid = 'unknown';
  let callSid = 'unknown';
  let oaReady = false;
  let haveGreeted = false;

  console.log('[WS] Twilio media stream connected');

  // 1) Connect to OpenAI Realtime (WebSocket)
  const oa = new WebSocket(
    // If your org uses the preview model, swap to gpt-4o-realtime-preview
    'wss://api.openai.com/v1/realtime?model=gpt-realtime',
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  oa.on('open', () => {
    oaReady = true;
    // Ask OA for μ-law in/out + server VAD + a warm voice
    oa.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: 'gpt-realtime',
        instructions: "You are Auntie, a warm, evidence-based postpartum support voice. Be brief, kind, and practical.",
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            turn_detection: { type: 'server_vad' }
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: 'aria'
          }
        }
      }
    }));
    // If Twilio already started, greet now (we need streamSid first to send audio back)
    if (streamSid && !haveGreeted) {
      haveGreeted = true;
      oa.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['audio'], instructions: "Hi love, I’m Auntie. I’m listening now." }
      }));
    }
  });

  oa.on('message', (data) => {
    // Forward OA audio deltas directly back to Twilio
    try {
      const evt = JSON.parse(data.toString());
      if (evt.type === 'response.output_audio.delta' && evt.delta && streamSid) {
        ws.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: evt.delta } // base64 μ-law @ 8 kHz
        }));
      }
      if (evt.type === 'response.completed' && streamSid) {
        // Optional: mark the end of the chunk so Twilio orders audio
        ws.send(JSON.stringify({
          event: 'mark',
          streamSid,
          mark: { name: 'auntie-turn-end' }
        }));
      }
    } catch {
      // ignore non-JSON frames
    }
  });

  oa.on('error', (e) => console.log('[OA] error', e?.message));
  oa.on('close', () => console.log('[OA] closed'));

  // 2) Twilio → OA: forward μ-law frames; OA VAD will decide when to speak
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    switch (msg.event) {
      case 'start':
        streamSid = msg.start?.streamSid || streamSid;
        callSid   = msg.start?.callSid   || callSid;
        console.log(`[WS] start: callSid=${callSid} streamSid=${streamSid}`);
        if (oaReady && !haveGreeted) {
          haveGreeted = true;
          oa.send(JSON.stringify({
            type: 'response.create',
            response: { modalities: ['audio'], instructions: "Hi love, I’m Auntie. I’m listening now." }
          }));
        }
        break;

      case 'media':
        // Twilio payload is base64 μ-law 8 kHz → forward as-is
        if (oaReady && msg.media?.payload) {
          oa.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: msg.media.payload
          }));
          // With server_vad, OA decides when to respond; no manual commit needed
        }
        break;

      case 'stop':
        console.log(`[WS] stop: callSid=${callSid}`);
        try { oa.close(); } catch {}
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    try { oa.close(); } catch {}
    console.log('[WS] Twilio media stream closed');
  });
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Auntie on :${PORT} (WS ready at /twilio-media)`);
});
