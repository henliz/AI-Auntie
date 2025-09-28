// backend/ai/brain.js
// Simple Gemini wrapper that returns a structured reply for SMS.
// If you prefer OpenAI, swap this out but keep the same return shape.

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: `
You are "Auntie": warm, concise for SMS. Ground answers in trusted postpartum guidance.
Return ONLY JSON with:
- intent: "COMFORT" | "RESOURCE" | "ESCALATE"
- topic: short tag
- region: optional
- reply_text: empathetic, actionable SMS reply
- red_flags: []
- updates: { context?: { delivery?, feeding?, weeks_postpartum?, region? } }
`
});

export async function generateAuntieReply(userText, { region } = {}) {
  const prompt = `
User text: ${userText}
Region hint: ${region || "unknown"}

Return valid JSON only with the exact keys described above.
  `;

  const out = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 200 }
  });

  let json;
  try {
    const raw = out.response.text().trim();
    json = JSON.parse(raw);
  } catch (e) {
    // Extremely defensive fallback
    json = {
      intent: "COMFORT",
      topic: "general",
      region: region || null,
      reply_text: "I’m here. Can you share a few more details so I can help better?",
      red_flags: [],
      updates: {}
    };
  }

  return {
    intent: json.intent || "COMFORT",
    topic: json.topic || "general",
    region: json.region ?? region ?? null,
    reply_text: json.reply_text || "I’m here for you.",
    red_flags: Array.isArray(json.red_flags) ? json.red_flags : [],
    updates: json.updates || {}
  };
}

// Backwards-compat export (if other files import brainReply)
export const brainReply = generateAuntieReply;
