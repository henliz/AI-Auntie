import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const systemInstruction = fs.readFileSync("ai/prompts/answer.system.md","utf8");
const facts = fs.readFileSync("ai/facts.jsonl","utf8").trim().split("\n").slice(0,3).map(l=>JSON.parse(l));

const payload = {
  channel: "SMS",
  route: "RESOURCE",
  user: "Baby won’t latch for 10 minutes—normal?",
  facts: facts.map(f=>`(${f.id}) ${f.snippet} [${f.source}]`),
  profile: { delivery: "unknown", region: "CA-ON" }
};

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

// Use pro if available, else fall back to flash-8b
const candidates = ["gemini-1.5-pro-001","gemini-1.5-flash-8b"];
const genAI = new GoogleGenerativeAI(apiKey);
let model;
for (const name of candidates) {
  try { model = genAI.getGenerativeModel({ model: name, systemInstruction }); console.log("ANSWER_MODEL:", name); break; }
  catch {}
}
if (!model) { console.error("No suitable model available"); process.exit(1); }

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

Format for SMS: 2–4 sentences + up to 3 bullets. End with “Want me to text …?”` }]
  }]
});

const text = res.response.text();
console.log("ANSWER:", text);
if (!/Want me to text/i.test(text)) { console.error("Answer missing checkback"); process.exit(1); }
