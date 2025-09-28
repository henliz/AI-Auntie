// text.js
import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const MessagingResponse = twilio.twiml.MessagingResponse;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
console.log("Gemini API Key loaded?", !!GEMINI_API_KEY);

const GEMINI_MODEL = "gemini-2.5-flash"; // safest for now

const AUNTIE_PROMPT = `
You are Auntie — a sweet, kind, bubbly support voice with caring, nurturing qualities.
Empathy first, plain words, no diagnosis. Normalize struggle, give 1–3 doable steps,
and always include safety thresholds if relevant. End with a gentle check-back like
"Would you like more ideas?" or "Does that feel helpful?"
`;

const MAX_SMS_LENGTH = 1500; // Twilio limit is 1600, keep buffer

app.post("/sms", async (req, res) => {
  const userMessage = req.body.Body;
  console.log("Incoming SMS:", userMessage);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `${AUNTIE_PROMPT}\n\nUser: ${userMessage}` }
              ]
            }
          ]
        })
      }
    );

    console.log("Gemini HTTP status:", response.status);
    let rawText = await response.text();
    console.log("Gemini raw response text:", rawText);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (err) {
      console.error("Error parsing JSON:", err);
      data = {};
    }

    const auntieReply =
      data?.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        .join(" ")
        ?.trim() ||
      "Sorry love, Auntie’s having a little trouble answering right now.";

    console.log("Auntie reply being sent:", auntieReply);

    // Break into multiple SMS chunks if needed
    const twiml = new MessagingResponse();
    const chunks = auntieReply.match(new RegExp(`.{1,${MAX_SMS_LENGTH}}`, "g")) || [];
    chunks.forEach(chunk => twiml.message(chunk));

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
  } catch (err) {
    console.error("Gemini fetch failed:", err);
    const twiml = new MessagingResponse();
    twiml.message("Sorry love, Auntie’s having a little trouble answering right now.");
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
  }
});

// Optional landing page
app.get("/", (req, res) => {
  res.send("Auntie SMS server is up 💌");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SMS Auntie server running on port ${PORT}`));
