// server.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

// your modules
const { formatReply } = require('./composer');
const ai = require('./ai');
const sf = require('./snowflake');
const db = require('./mongo');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// Twilio REST client (for sending SMS during voice calls)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_NUMBER;        // e.g., +12268878632 (E.164)
const twilioClient = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

// Static media for optional TTS <Play>
const MEDIA_DIR = path.join(__dirname, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR));

app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));

// ========================= SMS =========================
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

// ===== Optional OpenAI TTS (off by default: USE_TTS=false) =====
const USE_TTS = String(process.env.USE_TTS || 'false').toLowerCase() === 'true';

async function ttsToWavFile(text) {
  const msg = String(text).slice(0, 320); // keep short for latency
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'aria',   // warmer on phones (try 'verse' if you like)
      input: msg,
      format: 'wav'
    })
  });
  if (!res.ok) throw new Error(`OpenAI TTS failed: ${await res.text()}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const fname = `auntie-${Date.now()}.wav`;
  const fpath = path.join(MEDIA_DIR, fname);
  fs.writeFileSync(fpath, buf);
  return `/media/${fname}`;
}

function absoluteBase(req) {
  return process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
}

// ===== Phone-friendly SSML helpers (for Polly) =====
function escapeSSML(s='') {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function toSSML(text='') {
  // Insert tiny pauses between sentences; slow slightly for warmth
  const withBreaks = escapeSSML(text).replace(/([.!?])\s+/g, '$1 <break time="300ms"/> ');
  return `<speak><prosody rate="90%" pitch="+2%">${withBreaks}</prosody></speak>`;
}

// Speak helper: prefer Polly.Kendra + SSML (best over PSTN); optional OpenAI TTS
async function speak(twiml, req, text) {
  if (!USE_TTS) {
    twiml.say({ voice: 'Polly.Kendra' }, toSSML(text));
    return;
  }
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY');
    const rel = await ttsToWavFile(text);
    const url = absoluteBase(req) + rel;
    twiml.pause({ length: 1 });   // avoid first-word clipping on carriers
    twiml.play(url);
  } catch {
    twiml.say({ voice: 'Polly.Kendra' }, toSSML(text));
  }
}

// ========================= VOICE (turn 1) =========================
app.post('/twilio/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    action: '/twilio/voice/process',   // POST transcript here
    method: 'POST',
    language: 'en-US',
    speechTimeout: 'auto',
    hints: 'latch, c-section, bleeding, formula, lactation, postpartum, Telehealth',
    bargeIn: true,
    actionOnEmptyResult: false         // if silence, we’ll run the fallback line below
  });

  gather.say({ voice: 'Polly.Kendra' },
    "Hi love, I’m Auntie. In one sentence, tell me what you need tonight.");

  // If no speech captured in this gather:
  twiml.say({ voice: 'Polly.Kendra' },
    "I didn’t catch that. You can also text me. Sending hugs for tonight.");

  return res.type('text/xml').send(twiml.toString());
});

// ========================= VOICE (process) =========================
app.post('/twilio/voice/process', async (req, res) => {
  const spoken = (req.body.SpeechResult || '').trim();
  const from = req.body.From || '';
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const context = await db.getContext(from);
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: spoken, context, channel: 'voice' });

    // If RESOURCE/ESCALATE, text details so we don't read URLs aloud
    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
      if (twilioClient && twilioFrom && from) {
        const smsBody = formatReply({ bodyText: reply_text, resources });
        twilioClient.messages.create({ from: twilioFrom, to: from, body: smsBody }).catch(()=>{});
      }
    }

    // Speak the main reply (short, warm)
    await speak(twiml, req, reply_text);

    // Small pause then a follow-up gather
    twiml.pause({ length: 2 });
    const follow = twiml.gather({
      input: 'speech',
      action: '/twilio/voice/followup',
      method: 'POST',
      language: 'en-US',
      speechTimeout: 'auto',
      timeout: 4,               // wait up to 4s for them to start talking
      bargeIn: true,
      actionOnEmptyResult: false
    });
    follow.say({ voice: 'Polly.Kendra' }, "Do you need anything else? You can say yes or no.");

    // Only runs if no speech captured within timeout:
    twiml.say({ voice: 'Polly.Kendra' },
      "Okay. You’ve done enough for tonight. I’m here when you need me. Good night.");

    return res.type('text/xml').send(twiml.toString());

  } catch (e) {
    twiml.say({ voice: 'Polly.Kendra' },
      "Auntie glitched for a moment. Please text me and I’ll help there.");
    return res.type('text/xml').send(twiml.toString());
  }
});

// ========================= VOICE (follow-up) =========================
app.post('/twilio/voice/followup', async (req, res) => {
  const spoken = (req.body.SpeechResult || '').trim();
  const from = req.body.From || '';
  const twiml = new twilio.twiml.VoiceResponse();

  // If Twilio posted with silence (rare with our config), end kindly:
  if (!spoken) {
    twiml.say({ voice: 'Polly.Kendra' },
      "Okay. You’ve done enough for tonight. I’m here when you need me. Good night.");
    return res.type('text/xml').send(twiml.toString());
  }

  const lower = spoken.toLowerCase();
  const negative = /^(no(pe)?|nah|i(?:'| a)m good|all good|that'?s all|i'm fine|thanks|thank you)\b/.test(lower);

  if (negative) {
    twiml.say({ voice: 'Polly.Kendra' },
      "Proud of you for reaching out. Rest if you can. I’m here if you need me again. Good night.");
    return res.type('text/xml').send(twiml.toString());
  }

  try {
    const context = await db.getContext(from);
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: spoken, context, channel: 'voice' });

    // Send details by SMS (don’t read URLs aloud)
    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
    }
    if (twilioClient && twilioFrom && from) {
      const smsBody = formatReply({ bodyText: reply_text, resources });
      twilioClient.messages.create({ from: twilioFrom, to: from, body: smsBody }).catch(()=>{});
    }

    await speak(twiml, req, "I’ve texted you the details. If you need more, reply to my text anytime.");
    twiml.say({ voice: 'Polly.Kendra' }, "You’re doing more than enough. Good night.");
    return res.type('text/xml').send(twiml.toString());
  } catch {
    twiml.say({ voice: 'Polly.Kendra' },
      "I’ll text you the info instead. Reply there if you need more help. Good night.");
    return res.type('text/xml').send(twiml.toString());
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie on :${PORT}`));
