import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const systemInstruction = fs.readFileSync("ai/prompts/answer.system.md","utf8");
const facts = fs.readFileSync("ai/facts.jsonl","utf8").trim().split("\n").slice(0,3).map(l=>JSON.parse(l));
const payload = {
  channel: "SMS",
  route: "RESOURCE",
  user: "I had a C-section and my incision hurts. Is that normal?",
  facts: facts.map(f=>`(${f.id}) ${f.snippet} [${f.source}]`),
  profile: { delivery: "c-section", region: "CA-ON" }
};

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
  systemInstruction
});

const res = await model.generateContent({
  contents: [{
    role: "user",
    parts: [{ text:
`Channel=${payload.channel}
Route=${payload.route}
User="${payload.user}"
Profile=${JSON.stringify(payload.profile)}
Facts:
- ${payload.facts.join("\n- ")}` }]
  }]
});

const text = res.response.text();
console.log("ANSWER:", text);
if (!/Want me to text/i.test(text)) { console.error("Answer missing checkback"); process.exit(1); }
