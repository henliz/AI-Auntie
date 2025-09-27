// sms_auntie.js
import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Twilio credentials
const MessagingResponse = twilio.twiml.MessagingResponse;

// Gemini setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash"; // or whichever model you want

// Auntie personality prompt
const AUNTIE_PROMPT = `
You are Auntie — a sweet, kind, bubbly support voice with caring, nurturing qualities.
Empathy first, plain words, no diagnosis. Normalize struggle, give 1–3 doable steps,
and always include safety thresholds if relevant. End with a gentle check-back like
"Would you like more ideas?" or "Does that feel helpful?"
`;

// Twilio SMS webhook endpoint
app.post("/sms", async (req, res) => {
  const userMessage = req.body.Body;

  // Call Gemini API
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "system", parts: [{ text: AUNTIE_PROMPT }] },
          { role: "user", parts: [{ text: userMessage }] },
        ],
      }),
    }
  );
  const data = await response.json();
  const auntieReply =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Sorry love, Auntie’s having a little trouble answering right now.";

  // Twilio reply
  const twiml = new MessagingResponse();
  twiml.message(auntieReply);

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SMS Auntie server running on port ${PORT}`));
