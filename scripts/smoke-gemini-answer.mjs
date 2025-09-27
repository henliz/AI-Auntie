// REST v1 answer smoke (no SDK)
import fs from "node:fs";

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const systemInstruction = fs.readFileSync("ai/prompts/answer.system.md","utf8");
const facts = fs.readFileSync("ai/facts.jsonl","utf8").trim().split("\n").slice(0,3).map(l=>JSON.parse(l));

const PREFERRED = [
  "models/gemini-1.5-flash-8b",
  "models/gemini-1.5-flash-001",
  "models/gemini-1.5-flash",
  "models/gemini-1.0-pro",
  "models/gemini-pro"
];

async function listModelsV1() {
  const url = `https://generativelanguage.googleapis.com/v1/models?key=${API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`listModels ${r.status} ${r.statusText}`);
  return (await r.json()).models || [];
}

async function genContentV1(model, contents) {
  const url = `https://generativelanguage.googleapis.com/v1/${model}:generateContent?key=${API_KEY}`;
  const body = { contents };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`generateContent ${r.status} ${r.statusText}`);
  return await r.json();
}

(async () => {
  try {
    const models = await listModelsV1();
    const names = models.map(m => m.name);
    const usable = names.filter(n => PREFERRED.includes(n));
    const pick = usable[0] || names.find(n => /gemini.*(pro|flash)/.test(n));
    if (!pick) throw new Error("No v1 models visible to this key.");

    console.log("ANSWER_MODEL (v1):", pick);

    const payload = {
      channel: "SMS",
      route: "RESOURCE",
      user: "Baby won’t latch for 10 minutes—normal?",
      facts: facts.map(f=>`(${f.id}) ${f.snippet} [${f.source}]`),
      profile: { delivery: "unknown", region: "CA-ON" }
    };

    const userMsg =
`Channel=${payload.channel}
Route=${payload.route}
User="${payload.user}"
Profile=${JSON.stringify(payload.profile)}
Facts:
- ${payload.facts.join("\n- ")}

Format for SMS: 2–4 short sentences + up to 3 bullets. End with “Want me to text this?”`;

    const contents = [
      { role: "user", parts: [{ text: `${systemInstruction}\n\n${userMsg}` }] }
    ];

    const data = await genContentV1(pick, contents);
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";

    console.log("ANSWER:", text);
    if (!/Want me to text/i.test(text)) throw new Error("Answer missing checkback");

    process.exit(0);
  } catch (e) {
    console.error("Answer smoke failed:", e.message || e);
    process.exit(1);
  }
})();
