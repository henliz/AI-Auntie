// server.js — SMS + Voice (Twilio Media Streams ⇄ OpenAI Realtime; μ-law passthrough)
require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

// ---- your modules (can be stubs for now)
const { formatReply } = require('./composer');
const ai = require('./ai');
const sf = require('./snowflake');
const db = require('./mongo');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded

// ---------- health ----------
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));

// ---------- SMS webhook ----------
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

// ---------- Voice (Realtime) ----------
function wsStreamUrl(req) {
  const base = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  return base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/twilio-media';
}

// Voice webhook → returns TwiML that opens a Media Stream WS to us
app.all('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  connect.stream({
    url: wsStreamUrl(req),
    track: 'inbound_audio' // explicit; Twilio will stream caller audio to our WS
  });
  return res.type('text/xml').send(twiml.toString());
});

// ---------- HTTP server + WS upgrade ----------
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if ((request.url || '').startsWith('/twilio-media')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ---------- Twilio ⇄ OpenAI Realtime bridge ----------
wss.on('connection', (ws) => {
  let streamSid = 'unknown';
  let callSid = 'unknown';
  let oaReady = false;
  let sessionUpdated = false;
  let greeted = false;
  let mediaCount = 0;
  let keepAlive;

  console.log('///////////////////////////////////////////////////////////');
  console.log('[WS] Twilio media stream connected');

  const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview'; // try 'gpt-realtime' if needed
  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`,
    'realtime', // << important: Realtime WS subprotocol
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  oa.on('open', () => {
    oaReady = true;
    console.log('[OA] open');

    // Configure session: μ-law in/out, server VAD, voice, persona
    oa.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: MODEL,
        instructions:
          "You are Auntie, a warm, evidence-based postpartum support voice. " +
          "Be brief, kind, and practical. Offer one clear tip and a gentle check-in. " +
          "Avoid diagnosis; encourage seeking in-person care when appropriate.",
        output_modalities: ['audio'],
        audio: {
          input:  { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
          output: { format: { type: 'audio/pcmu' }, voice: process.env.OPENAI_VOICE || 'alloy' }
        }
      }
    }));

    // keep the socket alive
    keepAlive = setInterval(() => { try { oa.ping(); } catch {} }, 10000);
  });

  oa.on('unexpected-response', (req, res) => {
    console.log('[OA] unexpected-response', res.statusCode, res.statusMessage);
    res.on('data', d => console.log('[OA] body', d.toString()));
  });

  oa.on('message', (data) => {
    let evt;
    try { evt = JSON.parse(data.toString()); } catch { return; }

    if (evt.type === 'session.updated') {
      sessionUpdated = true;
      console.log('[OA] session.updated');
      if (streamSid && !greeted) {
        greeted = true;
        oa.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['audio'],
            instructions: "Hi love, I’m Auntie. I’m listening."
          }
        }));
      }
    }

    if (evt.type === 'rate_limits.updated') {
      console.log('[OA] rate_limits', JSON.stringify(evt.rate_limits || {}));
    }

    // OA → Twilio (audio deltas)
    if (evt.type === 'response.output_audio.delta' && evt.delta && streamSid) {
      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: evt.delta } // base64 μ-law (8kHz)
      }));
    }

    if (evt.type === 'response.completed' && streamSid) {
      ws.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'auntie-turn-end' } }));
    }
  });

  oa.on('error', (e) => console.log('[OA] error', e?.message));
  oa.on('close', () => { clearInterval(keepAlive); console.log('[OA] closed'); });

  // Twilio → OA
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.event) {
      case 'start':
        streamSid = msg.start?.streamSid || streamSid;
        callSid   = msg.start?.callSid   || callSid;
        console.log(`[WS] start: callSid=${callSid} streamSid=${streamSid}`);
        if (oaReady && !greeted && sessionUpdated) {
          greeted = true;
          oa.send(JSON.stringify({
            type: 'response.create',
            response: { modalities: ['audio'], instructions: "Hi love, I’m Auntie. I’m listening." }
          }));
        }
        break;

      case 'media':
        mediaCount++;
        if (mediaCount % 50 === 0) console.log(`[WS] media frames: ${mediaCount}`);
        if (oaReady && msg.media?.payload) {
          oa.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.media.payload }));
        }
        break;

      case 'stop':
        console.log(`[WS] stop: callSid=${callSid}, totalFrames=${mediaCount}`);
        try { oa.close(); } catch {}
        break;
    }
  });

  ws.on('close', () => {
    try { oa.close(); } catch {}
    console.log('[WS] Twilio media stream closed');
  });
});

// ---------- start ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Auntie on :${PORT} (WS at /twilio-media)`);
});
