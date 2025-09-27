// server.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

const { formatReply } = require('./composer');
const ai = require('./ai');
const sf = require('./snowflake');
const db = require('./mongo');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// --- Static media for voice <Play> ---
const MEDIA_DIR = path.join(__dirname, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR));

// --- Health & root ---
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));

// --- SMS webhook ---
app.all('/twilio/sms', async (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();

  try {
    // 1) minimal context
    const context = await db.getContext(from);

    // 2) "AI" (stub now; teammate will swap internals)
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: body, context });

    // 3) resources if needed
    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
    }

    // 4) log/save (stub now)
    await db.saveMessage({ phone: from, intent, topic, message: body });

    // 5) compose SMS
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(formatReply({ bodyText: reply_text, resources }));
    return res.type('text/xml').send(twiml.toString());
  } catch (e) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      "Auntie glitched—try again in a minute. If it feels urgent, call local emergency. 🌸"
    );
    return res.type('text/xml').send(twiml.toString());
  }
});

// --- OpenAI TTS helper (to MP3 on disk) ---
async function ttsToMp3File(text) {
  const msg = String(text).slice(0, 320); // keep short for latency
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy', // try 'aria' or 'verse' if you like
      input: msg,
      format: 'mp3'
    })
  });
  if (!res.ok) throw new Error(`OpenAI TTS failed: ${await res.text()}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const fname = `auntie-${Date.now()}.mp3`;
  const fpath = path.join(MEDIA_DIR, fname);
  fs.writeFileSync(fpath, buf);
  return `/media/${fname}`; // path to serve
}

// --- Voice: greet + <Gather speech> ---
app.post('/twilio/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    action: '/twilio/voice/process', // Twilio will POST transcript here
    method: 'POST',
    language: 'en-US',
    speechTimeout: 'auto'
  });

  gather.say(
    { voice: 'Polly.Joanna', language: 'en-US' },
    "Hi love, I’m Auntie. In one sentence, tell me what you need tonight."
  );

  // If no speech captured:
  twiml.say(
    { voice: 'Polly.Joanna' },
    "I didn’t catch that. You can also text me. Sending hugs for tonight."
  );
  return res.type('text/xml').send(twiml.toString());
});

// --- Voice processor: AI reply -> TTS -> <Play> (fallback to <Say>) ---
app.post('/twilio/voice/process', async (req, res) => {
  const spoken = (req.body.SpeechResult || '').trim();
  const from = req.body.From || '';
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const context = await db.getContext(from);
    const { reply_text } = await ai.getAuntieReply({ text: spoken, context });

    let audioPath;
    try {
      if (!process.env.OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY');
      audioPath = await ttsToMp3File(reply_text);
    } catch {
      // fall back to <Say> below
    }

    if (audioPath) {
      const base =
        process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
      twiml.play(`${base}${audioPath}`);
    } else {
      twiml.say({ voice: 'Polly.Joanna' }, reply_text);
    }

    twiml.pause({ length: 1 });
    twiml.say(
      { voice: 'Polly.Joanna' },
      'If you need more, text me anytime. Good night.'
    );
    return res.type('text/xml').send(twiml.toString());
  } catch (e) {
    twiml.say(
      { voice: 'Polly.Joanna' },
      "Auntie glitched for a moment. Please text me and I’ll help there."
    );
    return res.type('text/xml').send(twiml.toString());
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie on :${PORT}`));

