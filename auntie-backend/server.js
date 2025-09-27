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

app.all('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  // Short hello so callers know it's live
  twiml.say({ voice: 'Polly.Kendra' }, "Hi love, I’m Auntie. I’m listening now.");

  // Bidirectional media stream to our WS endpoint
  const connect = twiml.connect();
  connect.stream({ url: wsStreamUrl(req) }); // <-- no 'track' here

  return res.type('text/xml').send(twiml.toString());
});



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
  // ---- inside wss.on('connection', (ws, request) => { ... }) ----
let frames = 0;
let streamSid = 'unknown';
let callSid = 'unknown';

// 1) Connect to OpenAI Realtime (WebSocket)
const oaHeaders = {
  'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  'OpenAI-Beta': 'realtime=v1'
};
const oa = new WebSocket(
  'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
  { headers: oaHeaders }
);

// Simple queue if Twilio media arrives before OA is ready
let oaReady = false;
let pendingBatches = [];

// Ask OpenAI to output audio as PCM16 @ 16k
oa.on('open', () => {
  oaReady = true;
  oa.send(JSON.stringify({
    type: 'session.update',
    session: { audio_format: { type: 'pcm16', sample_rate: 16000 } }
  }));
  // Prime Auntie’s vibe
  oa.send(JSON.stringify({
    type: 'response.create',
    response: {
      instructions: "You are Auntie, a warm, evidence-based postpartum support voice. Keep responses brief, speak gently, and pause between ideas."
    }
  }));
  // Flush any early caller audio
  for (const b of pendingBatches) oa.send(b);
  pendingBatches = [];
});

// 2) Helpers: μ-law <-> PCM16 and resampling
function muLawDecodeByte(u) {
  u = ~u & 0xff;
  const sign = (u & 0x80);
  let exponent = (u >> 4) & 0x07;
  let mantissa = u & 0x0f;
  let sample = ((mantissa << 4) + 0x08) << (exponent + 3);
  sample -= 0x84; // 132
  return (sign ? -sample : sample);
}
function muLawDecode(base64) {
  const buf = Buffer.from(base64, 'base64');
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = muLawDecodeByte(buf[i]);
  return out;
}
function muLawEncodeSample(pcm) {
  const BIAS = 0x84; // 132
  let sign = (pcm < 0) ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  if (pcm > 32635) pcm = 32635;
  pcm += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  let mantissa = (pcm >> (exponent + 3)) & 0x0f;
  let mu = ~(sign | (exponent << 4) | mantissa);
  return mu & 0xff;
}
function muLawEncode(int16) {
  const out = Buffer.alloc(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = muLawEncodeSample(int16[i]);
  return out.toString('base64');
}
function upsample8kTo16k(int16_8k) { // linear 2x
  const n = int16_8k.length;
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n - 1; i++) {
    const a = int16_8k[i], b = int16_8k[i+1];
    out[2*i] = a;
    out[2*i+1] = (a + b) >> 1;
  }
  // last sample
  out[out.length - 2] = int16_8k[n - 1];
  out[out.length - 1] = int16_8k[n - 1];
  return out;
}
function downsample16kTo8k(int16_16k) { // simple 2:1 average
  const out = new Int16Array(Math.floor(int16_16k.length / 2));
  for (let i = 0, j = 0; j < out.length; i += 2, j++) {
    out[j] = (int16_16k[i] + int16_16k[i+1]) >> 1;
  }
  return out;
}

// 3) When OpenAI sends audio chunks, forward to Twilio as μ-law @ 8k
oa.on('message', (data) => {
  try {
    // Realtime sends JSON events and sometimes binary; we only care about JSON here
    const evt = JSON.parse(data.toString());
    if (evt.type === 'response.output_audio.delta' && evt.audio) {
      // evt.audio is base64 PCM16 16k
      const pcm16 = new Int16Array(Buffer.from(evt.audio, 'base64').buffer);
      const pcm8k = downsample16kTo8k(pcm16);
      const ulawB64 = muLawEncode(pcm8k);

      // Send to Twilio as a media frame (~20ms chunks). These chunks may be longer; Twilio will buffer.
      ws.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: ulawB64 }
      }));
    }
    // You can also watch for 'response.completed' to know the model finished a turn
  } catch (_) {
    // ignore non-JSON frames from OA
  }
});

oa.on('close', () => console.log('[OA] closed'));
oa.on('error', (e) => console.log('[OA] error', e?.message));

// 4) Handle Twilio -> us (caller audio) and forward to OpenAI
let inputBatch = [];           // collect ~1s of audio then commit
const FRAMES_PER_COMMIT = 50;  // Twilio sends ~20ms frames -> ~1s

ws.on('message', (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }

  switch (msg.event) {
    case 'start':
      streamSid = msg.start?.streamSid || streamSid;
      callSid = msg.start?.callSid || callSid;
      console.log(`[WS] start: callSid=${callSid} streamSid=${streamSid}`);
      break;

    case 'media':
      frames++;
      // decode μ-law 8k -> PCM16 8k -> upsample to 16k
      const pcm8 = muLawDecode(msg.media.payload);
      const pcm16 = upsample8kTo16k(pcm8);
      // push to batch as base64 PCM16 (little-endian)
      inputBatch.push(Buffer.from(pcm16.buffer));

      // every ~1s, send batch to OA and ask for a response
      if (frames % FRAMES_PER_COMMIT === 0 && oaReady && oa.readyState === WebSocket.OPEN) {
        const joined = Buffer.concat(inputBatch);
        inputBatch = [];

        oa.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: joined.toString('base64')
        }));
        oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        oa.send(JSON.stringify({
          type: 'response.create',
          response: { modalities: ['audio'], instructions: 'Keep it brief, warm, and practical.' }
        }));
      }
      break;

    case 'stop':
      console.log(`[WS] stop: callSid=${callSid} totalFrames=${frames}`);
      // Close OA nicely
      try { oa.close(); } catch {}
      break;

    default:
      // other events: mark, clear, dtmf, etc.
      break;
  }
});

ws.on('close', () => {
  try { oa.close(); } catch {}
  console.log('[WS] Twilio media stream closed');
});


// ========================= START SERVER =========================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Auntie on :${PORT} (WS ready at /twilio-media)`);
});
