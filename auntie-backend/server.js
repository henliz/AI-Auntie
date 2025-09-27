// server.js — SMS + Voice (Twilio Media Streams + OpenAI Realtime)
// Requires: npm i ws
require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

// Your local modules (keep your stubs/real impls)
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
  } catch (e) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Auntie glitched—try again in a minute. If it feels urgent, call local emergency. 🌸");
    return res.type('text/xml').send(twiml.toString());
  }
});

// ---------- Voice (Media Stream entry; NO Polly greeting) ----------
function wsStreamUrl(req) {
  const base = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  return base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/twilio-media';
}

app.all('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const connect = twiml.connect();
  // Bidirectional stream so we can send audio back to the caller
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

// ---------- WS bridge: Twilio ⇄ OpenAI Realtime (simple back-and-forth) ----------
wss.on('connection', (ws, request) => {
  let frames = 0;
  let streamSid = 'unknown';
  let callSid = 'unknown';

  console.log('[WS] Twilio media stream connected');

  // 1) Connect to OpenAI Realtime (WebSocket)
  const oaHeaders = {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'OpenAI-Beta': 'realtime=v1',
  };
  const oa = new WebSocket(
    'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
    { headers: oaHeaders }
  );

  let oaReady = false;
  let pendingBatches = [];

  // Ask OpenAI to speak in a chosen voice and 16k PCM audio
  oa.on('open', () => {
    oaReady = true;
    oa.send(JSON.stringify({
      type: 'session.update',
      session: {
        // pick a voice you like: aria, verse, serene, alloy
        voice: 'aria',
        audio_format: { type: 'pcm16', sample_rate: 16000 }
      }
    }));
    // Intro line from OA (no Polly at all)
    oa.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['audio'],
        instructions: "Hi love, I’m Auntie. I’m listening now."
      }
    }));
    // Flush any early caller audio
    for (const b of pendingBatches) oa.send(b);
    pendingBatches = [];
  });

  // 2) μ-law <-> PCM16 helpers + resampling
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

  // 3) OpenAI → Twilio (stream model audio back to caller)
  oa.on('message', (data) => {
    try {
      const evt = JSON.parse(data.toString());
      if (evt.type === 'response.output_audio.delta' && evt.audio) {
        // evt.audio is base64 PCM16 16k
        const buf = Buffer.from(evt.audio, 'base64');
        const pcm16 = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
        const pcm8k = downsample16kTo8k(pcm16);
        const ulawB64 = muLawEncode(pcm8k);
        ws.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: ulawB64 }
        }));
      }
      // You can also listen for 'response.completed' to mark turn end.
    } catch {
      // sometimes OA sends binary frames; ignore non-JSON here
    }
  });

  oa.on('close', () => console.log('[OA] closed'));
  oa.on('error', (e) => console.log('[OA] error', e?.message));

  // 4) Twilio → OpenAI (caller audio up) — simple chunked back-and-forth
  let inputBatch = [];
  const FRAMES_PER_COMMIT = 30; // ~600ms at ~20ms frames for snappier replies

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
        // μ-law 8k -> PCM16 8k -> upsample to 16k
        const pcm8 = muLawDecode(msg.media.payload);
        const pcm16 = upsample8kTo16k(pcm8);
        inputBatch.push(Buffer.from(pcm16.buffer));

        // Every ~0.6s, send batch to OA and ask for a spoken reply
        if (frames % FRAMES_PER_COMMIT === 0) {
          const joined = Buffer.concat(inputBatch);
          inputBatch = [];
          const appendMsg = JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: joined.toString('base64')
          });
          if (oaReady && oa.readyState === WebSocket.OPEN) {
            oa.send(appendMsg);
            oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            oa.send(JSON.stringify({
              type: 'response.create',
              response: { modalities: ['audio'], instructions: 'Answer briefly, warm and practical.' }
            }));
          } else {
            pendingBatches.push(appendMsg);
          }
        }
        break;

      case 'stop':
        console.log(`[WS] stop: callSid=${callSid} totalFrames=${frames}`);
        try { oa.close(); } catch {}
        break;

      default:
        // keep-alives, marks, etc.
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
