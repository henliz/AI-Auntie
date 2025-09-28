// text.js
import express from "express";
import bodyParser from "body-parser";
import twilio from "twilio";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
console.log("Gemini API Key loaded?", !!GEMINI_API_KEY);

const GEMINI_MODEL = "gemini-2.5-flash"; // safest for now

const AUNTIE_PROMPT = `
You are Auntie — a sweet, kind, bubbly support voice with caring, nurturing qualities.
Empathy first, plain words, no diagnosis. Normalize struggle, give 1–3 doable steps,
and always include safety thresholds if relevant. End with a gentle check-back like
"Would you like more ideas?" or "Does that feel helpful?"
`;

const MAX_SMS_LENGTH = 400; // new limit per chunk
const MAX_SMS_COUNT = 5;    // cap Auntie at 5 messages
const MESSAGE_DELAY_MS = 4000; // 4s delay between sends

// Twilio REST client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.post("/twilio/sms", async (req, res) => {
  const userMessage = req.body.Body;
  const from = req.body.To;      // Twilio number
  const to = req.body.From;      // User number
  console.log("Incoming SMS:", userMessage);

  try {
    // --- 1. Call Gemini ---
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

    console.log("Auntie reply (full):", auntieReply);

    // --- 2. Split reply into 400-char chunks ---
    let chunks = auntieReply.match(new RegExp(`.{1,${MAX_SMS_LENGTH}}`, "g")) || [];

    // Cap at 5 messages max
    if (chunks.length > MAX_SMS_COUNT) {
      chunks = [
        ...chunks.slice(0, MAX_SMS_COUNT - 1),
        chunks.slice(MAX_SMS_COUNT - 1).join(" ") + "\n...(message shortened)..."
      ];
    }

    console.log(`Preparing to send ${chunks.length} messages`);

    // --- 3. Respond immediately to Twilio ---
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<Response></Response>");

    // --- 4. Send sequentially with delay ---
    for (let i = 0; i < chunks.length; i++) {
      await client.messages.create({ from, to, body: chunks[i] });
      console.log(`Sent chunk ${i + 1}/${chunks.length}`);

      if (i < chunks.length - 1) {
        await sleep(MESSAGE_DELAY_MS); // ⏳ 4s delay
      }
    }
  } catch (err) {
    console.error("Error handling SMS:", err);
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<Response><Message>Sorry love, Auntie’s having a little trouble answering right now.</Message></Response>");
  }
});

// Optional landing page
app.get("/", (req, res) => {
  res.send("Auntie SMS server is up 💌");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SMS Auntie server running on port ${PORT}`));
