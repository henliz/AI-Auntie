// server.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

// ---- imports from your codebase
const { formatReply } = require('./composer');
const ai = require('./ai');
const sf = require('./snowflake');
const db = require('./mongo');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// ---- Twilio REST client (for sending SMS during voice calls)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_NUMBER; // your purchased Twilio number, e.g., +1226...
const twilioClient = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

// ---- Static media for <Play> (TTS files)
const MEDIA_DIR = path.join(__dirname, 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR));

// ---- Health & root
app.get('/health', (_req, res) => res.send('ok'));
app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));

// ======================================================================
// SMS WEBHOOK
// ======================================================================
app.all('/twilio/sms', async (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();

  try {
    // 1) minimal context
    const context = await db.getContext(from);

    // 2) AI (stub now; teammate swaps internals)
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: body, context });

    // 3) resources if needed
    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
    }

    // 4) save (stub now)
    await db.saveMessage({ phone: from, intent, topic, message: body });

    // 5) reply
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(formatReply({ bodyText: reply_text, resources }));
    return res.type('text/xml').send(twiml.toString());
  } catch (e) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Auntie glitched—try again in a minute. If it feels urgent, call local emergency. 🌸");
    return res.type('text/xml').send(twiml.toString());
  }
});

// ======================================================================
// OpenAI TTS helper (generate WAV, serve via /media, then <Play> it)
// ======================================================================
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
      voice: 'aria',       // warmer on PSTN; try 'verse' if you prefer
      input: msg,
      format: 'wav'
    })
  });
  if (!res.ok) throw new Error(`OpenAI TTS failed: ${await res.text()}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const fname = `auntie-${Date.now()}.wav`;
  const fpath = path.join(MEDIA_DIR, fname);
  fs.writeFileSync(fpath, buf);
  return `/media/${fname}`; // path served by this app
}

function absoluteBase(req) {
  return process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
}

async function speakText(twiml, req, text) {
  // Prefer TTS <Play>; fall back to <Say> if TTS fails
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('No OPENAI_API_KEY');
    const rel = await ttsToWavFile(text);
    const url = absoluteBase(req) + rel;
    twiml.pause({ length: 1 }); // avoid first-word clipping
    twiml.play(url);
  } catch {
    twiml.say({ voice: 'Polly.Joanna' }, text);
  }
}

// ======================================================================
// VOICE: Entry (Gather speech)
// ======================================================================
app.post('/twilio/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    action: '/twilio/voice/process',  // POST transcript here
    method: 'POST',
    language: 'en-US',
    speechTimeout: 'auto',
    hints: 'latch, c-section, bleeding, formula, lactation, postpartum, Telehealth',
    bargeIn: true
  });

  gather.say({ voice: 'Polly.Joanna' }, "Hi love, I’m Auntie. In one sentence, tell me what you need tonight.");

  // If no speech captured, this runs:
  twiml.say({ voice: 'Polly.Joanna' }, "I didn’t catch that. You can also text me. Sending hugs for tonight.");
  return res.type('text/xml').send(twiml.toString());
});

// ======================================================================
// VOICE: Process first utterance -> reply -> brief follow-up prompt
// ======================================================================
app.post('/twilio/voice/process', async (req, res) => {
  const spoken = (req.body.SpeechResult || '').trim();
  const from = req.body.From || '';
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    // 1) triage with same brain (voice channel)
    const context = await db.getContext(from);
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: spoken, context, channel: 'voice' });

    // 2) resources (and SMS them so caller gets links)
    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
      if (twilioClient && twilioFrom && from) {
        const smsBody = formatReply({ bodyText: reply_text, resources });
        // fire-and-forget; don't block the call
        twilioClient.messages.create({ from: twilioFrom, to: from, body: smsBody }).catch(() => {});
      }
    }

    // 3) speak the main reply
    await speakText(twiml, req, reply_text);

    // 4) tiny pause, then gentle follow-up question
    twiml.pause({ length: 2 });
    const follow = twiml.gather({
      input: 'speech',
      action: '/twilio/voice/followup',
      method: 'POST',
      language: 'en-US',
      speechTimeout: 'auto',
      timeout: 2,                 // if silence, continue to the next <Say>
      hints: 'no, nope, all good, yes, another question, help, connect me',
      bargeIn: true
    });
    follow.say({ voice: 'Polly.Joanna' }, "Do you need anything else? You can say ‘no’ to finish.");

    // If caller stays silent here, close kindly:
    twiml.say({ voice: 'Polly.Joanna' }, "Okay. You’ve done enough for tonight. I’m texting you details—reply there if you want more help. Good night.");
    return res.type('text/xml').send(twiml.toString());

  } catch (e) {
    twiml.say({ voice: 'Polly.Joanna' }, "Auntie glitched for a moment. Please text me and I’ll help there.");
    return res.type('text/xml').send(twiml.toString());
  }
});

// ======================================================================
// VOICE: Follow-up turn -> either goodbye, or quick answer + SMS
// ======================================================================
app.post('/twilio/voice/followup', async (req, res) => {
  const spoken = (req.body.SpeechResult || '').trim();
  const from = req.body.From || '';
  const twiml = new twilio.twiml.VoiceResponse();

  // If nothing was said, end kindly (this path is hit if actionOnEmptyResult=true;
  // with timeout we also fall through to previous <Say>)
  if (!spoken) {
    twiml.say({ voice: 'Polly.Joanna' }, "Okay. You’ve done enough for tonight. I’m here when you need me. Good night.");
    return res.type('text/xml').send(twiml.toString());
  }

  const lower = spoken.toLowerCase();
  const negative = /^(no(pe)?|nah|i(?:'| a)m good|all good|that'?s all|i'm fine|thanks|thank you)\b/.test(lower);

  if (negative) {
    twiml.say({ voice: 'Polly.Joanna' }, "Proud of you for reaching out. Rest if you can. I’m here if you need me again. Good night.");
    return res.type('text/xml').send(twiml.toString());
  }

  try {
    // Another brief answer, but nudge to SMS for details
    const context = await db.getContext(from);
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: spoken, context, channel: 'voice' });

    // Send details by SMS
    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
    }
    if (twilioClient && twilioFrom && from) {
      const smsBody = formatReply({ bodyText: reply_text, resources });
      twilioClient.messages.create({ from: twilioFrom, to: from, body: smsBody }).catch(() => {});
    }

    // Speak a short closer
    await speakText(twiml, req, "I’ve texted you the details. If you need more, reply to my text anytime.");
    twiml.say({ voice: 'Polly.Joanna' }, "You’re doing more than enough. Good night.");
    return res.type('text/xml').send(twiml.toString());
  } catch {
    twiml.say({ voice: 'Polly.Joanna' }, "I’ll text you the info instead. Reply there if you need more help. Good night.");
    return res.type('text/xml').send(twiml.toString());
  }
});

// ---- start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie on :${PORT}`));


