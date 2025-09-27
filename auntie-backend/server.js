require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { formatReply } = require('./composer');


const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded

// healthcheck
app.get('/health', (_req, res) => res.send('ok'));

// SMS webhook — returns TwiML with a hard-coded reply
app.post('/twilio/sms', (req, res) => {
  const body = (req.body.Body || '').trim();
  const reply_text =
  "You’ve got this. Try 20 minutes of skin-to-skin and sip some water—small resets help both you and baby tonight.";

  const resources = [
    { name: 'PSI Helpline', phone: '1-800-944-4773', url: 'https://postpartum.net' },
    { name: 'Public Health Nurse (Waterloo)', phone: '519-575-4400', url: 'https://www.regionofwaterloo.ca' }
  ];

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message( formatReply({ bodyText: reply_text, resources }) );
  return res.type('text/xml').send(twiml.toString());

  res.type('text/xml').send(twiml.toString()); // Twilio expects XML
});

// optional: a voice placeholder so calls don’t 404
app.post('/twilio/voice', (_req, res) => {
  const vr = new twilio.twiml.VoiceResponse();
  vr.say({ voice: 'alice' }, 'Thanks for calling AI Auntie. Text me for the live demo!');
  res.type('text/xml').send(vr.toString());
});

app.get('/', (_req, res) => res.send('AI Auntie backend is up 🌸'));
app.listen(process.env.PORT, () =>
  console.log(`Auntie listening on http://localhost:${process.env.PORT}`)
);
