// server.js — SMS + Voice (Twilio Media Streams ⇄ OpenAI Realtime)
// npm i express twilio ws dotenv

require('dotenv').config();

const express = require('express');
const twilio = require('twilio');
const http = require('http');
const WebSocket = require('ws');

// ---- optional local modules (keep your stubs/real impls) ----
let formatReply, ai, sf, db;
try { ({ formatReply } = require('./composer')); } catch { formatReply = ({ bodyText }) => bodyText; }
try { ai = require('./ai'); } catch { ai = { getAuntieReply: async ({ text }) => ({ intent: 'COMFORT', topic: 'general', region: 'demo', reply_text: `Auntie here: ${text}` }) }; }
try { sf = require('./snowflake'); } catch { sf = { lookupResources: async () => [] }; }
try { db = require('./mongo'); } catch { db = { getContext: async () => ({}), saveMessage: async () => {} }; }

// ---- sanity envs ----
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in env');
  process.exit(1);
}

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio form-encoded posts

// ---------- health ----------
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

// ---------- Voice: TwiML that connects Media Stream ----------
function wsStreamUrl(req) {
  // Prefer Render’s public URL if provided
  const base = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const wssBase = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${wssBase}/twilio-media`;
}

// Twilio “A CALL COMES IN” should point to this route
app.all('/twilio/voice-rt', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  // Optional: a super short prompt so callers aren’t confused before the stream starts
  // twiml.say({ voice: 'Google.en-US-Neural2-C' }, 'Connecting you to Auntie.');
  const connect = twiml.connect();
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

// ---------- WS bridge: Twilio ⇄ OpenAI Realtime ----------
wss.on('connection', (ws, request) => {
  console.log('///////////////////////////////////////////////////////////');
  console.log('[WS] Twilio media stream connected');

  let streamSid = null;
  let callSid = null;

  // Connect to OpenAI Realtime with proper subprotocol + header
  const oaHeaders = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'realtime=v1',
  };

  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';

  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    'realtime',                             // ← subprotocol (required)
    { headers: oaHeaders }                  // ← header (required)
  );

  let oaOpen = false;

  // Configure the session for μ-law both ways so we can passthrough
  oa.on('open', () => {
    oaOpen = true;
    console.log('[OA] open');
    oa.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        model,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcmu' },          // Twilio G.711 μ-law
            turn_detection: { type: 'server_vad' }   // let OA detect turns
          },
          output: {
            format: { type: 'audio/pcmu' },          // send back μ-law
            voice: process.env.OA_VOICE || 'aria'    // alloy|aria|verse|serene…
          }
        },
        instructions:
          "You are Auntie: warm, concise, evidence-based postpartum support. " +
          "Keep answers short and practical for a phone call. If pain is severe, " +
          "bleeding heavy, or self-harm is mentioned, calmly recommend urgent care."
      }
    }));

    // (Optional) Have Auntie speak first so you hear something immediately
    oa.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['audio'],
        instructions: "Hi love, I’m Auntie. I’m listening—tell me what you need."
      }
    }));
  });

  oa.on('message', (data) => {
    // OpenAI sends JSON control events and base64 audio deltas
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session.updated') {
        console.log('[OA] session.updated');
      }
      // Realtime API commonly uses .delta for μ-law audio chunks
      if (msg.type === 'response.output_audio.delta' && msg.delta) {
        if (!streamSid) return; // not yet started
        ws.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: msg.delta }   // passthrough μ-law base64
        }));
      }
      if (msg.type === 'response.completed') {
        // mark the end of a response if you like
      }
    } catch {
      // Non-JSON frames can be ignored for this demo
    }
  });

  oa.on('close', () => console.log('[OA] closed'));
  oa.on('error', (e) => console.log('[OA] error', e?.message));

  // Accumulate caller audio briefly, then commit to OA (snappy turn-taking)
  let frameCount = 0;
  const FRAMES_PER_COMMIT = 25; // ~500ms (Twilio frames are ~20ms)

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.event) {
      case 'start':
        streamSid = msg.start?.streamSid || streamSid;
        callSid = msg.start?.callSid || callSid;
        console.log(`[WS] start: callSid=${callSid} streamSid=${streamSid}`);
        break;

      case 'media':
        // Forward μ-law base64 directly to OA buffer
        if (oaOpen && oa.readyState === WebSocket.OPEN) {
          oa.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: msg.media.payload
          }));
          frameCount++;
          if (frameCount % FRAMES_PER_COMMIT === 0) {
            oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            oa.send(JSON.stringify({
              type: 'response.create',
              response: { modalities: ['audio'] }
            }));
          }
        }
        break;

      case 'mark':
        // can be used to know when a chunk fully played
        break;

      case 'stop':
        console.log(`[WS] stop: callSid=${callSid}`);
        try { oa.close(); } catch {}
        break;

      default:
        // keep-alives, etc.
        break;
    }
  });

  ws.on('close', () => {
    try { oa.close(); } catch {}
    console.log('[WS] Twilio media stream closed');
  });
});

// ---------- start ----------
server.listen(PORT, () => {
  console.log(`Auntie listening on :${PORT}`);
  console.log(`Voice TwiML route:   POST https://<host>/twilio/voice-rt`);
  console.log(`Media Stream route:  wss://<host>/twilio-media`);
});
