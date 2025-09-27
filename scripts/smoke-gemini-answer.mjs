import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const systemInstruction = fs.readFileSync("ai/prompts/answer.system.md","utf8");
const facts = fs.readFileSync("ai/facts.jsonl","utf8").trim().split("\n").slice(0,3).map(l=>JSON.parse(l));

const PREFERRED = [
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash-001",
  "gemini-1.5-flash",
  "gemini-1.0-pro",
  "gemini-pro"
];

const genAI = new GoogleGenerativeAI(apiKey);

async function pickModel() {
  try {
    const models = await genAI.listModels();
    const names = models?.models?.map(m => m.name?.replace(/^models\//, "")) || [];
    console.log("AVAILABLE MODELS:", names.join(", ") || "(none)");
    for (const want of PREFERRED) {
      if (names.includes(want) || names.includes(`models/${want}`)) return want;
    }
    return names.find(n => /gemini.*(pro|flash)/.test(n)) || null;
  } catch (e) {
    console.warn("listModels failed, falling back to 1.0 pro:", e?.message || e);
    return "gemini-1.0-pro";
  }
}

const payload = {
  channel: "SMS",
  route: "RESOURCE",
  user: "Baby won’t latch for 10 minutes—normal?",
  facts: facts.map(f=>`(${f.id}) ${f.snippet} [${f.source}]`),
  profile: { delivery: "unknown", region: "CA-ON" }
};

(async () => {
  const modelName = await pickModel();
  if (!modelName) { console.error("No usable models visible to this API key."); process.exit(1); }
  console.log("ANSWER_MODEL:", modelName);

  const model = genAI.getGenerativeModel({ model: modelName, systemInstruction });

  const res = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{ text:
`Channel=${payload.channel}
Route=${payload.route}
User="${payload.user}"
Profile=${JSON.stringify(payload.profile)}
Facts:
- ${payload.facts.join("\n- ")}

Format for SMS: 2–4 short sentences + up to 3 bullets. End with “Want me to text this?”` }]
    }]
  });

  const text = res.response.text();
  console.log("ANSWER:", text);
  if (!/Want me to text/i.test(text)) { console.error("Answer missing checkback"); process.exit(1); }
})();
