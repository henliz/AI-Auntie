require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const { formatReply } = require('./composer');
const ai = require('./ai');
const sf = require('./snowflake');
const db = require('./mongo');



const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// healthcheck
app.get('/health', (_req, res) => res.send('ok'));

// SMS webhook — returns TwiML with a hard-coded reply
app.all('/twilio/sms', async (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();

  try {
    // 1) read minimal context
    const context = await db.getContext(from);

    // 2) ask "AI" (stubbed for now)
    const { intent, topic, region, reply_text } =
      await ai.getAuntieReply({ text: body, context });

    // 3) if needed, fetch resources (stubbed for now)
    let resources = [];
    if (intent === 'RESOURCE' || intent === 'ESCALATE') {
      resources = await sf.lookupResources({ topic, region });
    }

    // 4) save the message (stubbed store)
    await db.saveMessage({ phone: from, intent, topic, message: body });

    // 5) compose a short, cozy SMS and send
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message( formatReply({ bodyText: reply_text, resources }) );
    return res.type('text/xml').send(twiml.toString());

  } catch (e) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Auntie glitched—try again in a minute. If it feels urgent, call local emergency. 🌸");
    return res.type('text/xml').send(twiml.toString());
  }
});


// optional: a voice placeholder so calls don’t 404
app.post('/twilio/voice', (_req, res) => {
  const vr = new twilio.twiml.VoiceResponse();
  vr.say({ voice: 'alice' }, 'Thanks for calling AI Auntie. Text me for the live demo!');
  res.type('text/xml').send(vr.toString());
});

app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Auntie on :${PORT}`));
