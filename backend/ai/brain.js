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

export async function brainReply({ text, context = {}, region = null, history = [] }) {
  const prompt = [
    `User context: ${JSON.stringify(context)}`,
    `Short history:\n${history.map(h => `${h.sender}: ${h.text}`).join("\n")}`,
    `Now user says: "${text}"`
  ].join("\n\n");

  const out = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }]}],
    generationConfig: {
      temperature: 0.6,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          intent: { type: "string", enum: ["COMFORT","RESOURCE","ESCALATE"] },
          topic: { type: "string" },
          region: { type: "string", nullable: true },
          reply_text: { type: "string" },
          red_flags: { type: "array", items: { type: "string" } },
          updates: { type: "object", properties: { context: { type: "object", additionalProperties: true, nullable: true } } }
        },
        required: ["intent","topic","reply_text","red_flags"],
        additionalProperties: false
      }
    }
  });

  const json = JSON.parse(out.response.text());
  return {
    intent: json.intent,
    topic: json.topic,
    region: json.region ?? region ?? null,
    reply_text: json.reply_text,
    red_flags: json.red_flags || [],
    updates: json.updates || {}
  };
}
