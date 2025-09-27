// REST v1 router smoke (no SDK)
import fs from "node:fs";

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const systemInstruction = fs.readFileSync("ai/prompts/router.system.md","utf8");
const triageSchema = JSON.parse(fs.readFileSync("ai/triage.schema.json","utf8"));
const userText = "Baby won’t latch for 10 minutes—normal?";

const PREFERRED = [
  "models/gemini-1.5-flash-8b",
  "models/gemini-1.5-flash-001",
  "models/gemini-1.5-flash",
  "models/gemini-1.0-pro",
  "models/gemini-pro"
];

function cleanJson(s) {
  return JSON.parse(
    s.trim()
     .replace(/```json/gi,"").replace(/```/g,"")
     .replace(/^[^{\[]+/, "").replace(/[^}\]]+$/, "")
  );
}

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

    console.log("USING MODEL (v1):", pick);

    // Prepare contents (system + user). REST v1 doesn’t have function calling, so we force JSON output in the user turn.
    const contents = [
      { role: "user", parts: [{ text: `${systemInstruction}\n\nReturn ONLY JSON {intent,topic,red_flags,confidence}.\nUser: "${userText}"` }] }
    ];

    const data = await genContentV1(pick, contents);

    // Parse
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
    let routed;
    try { routed = cleanJson(text); } catch { routed = null; }

    if (!routed) throw new Error("Router returned non-JSON");

    console.log("USER:", userText);
    console.log("ROUTED:", routed);
    if (!["COMFORT","RESOURCE","ESCALATE"].includes(routed.intent)) throw new Error("Invalid intent");

    process.exit(0);
  } catch (e) {
    console.error("Router smoke failed:", e.message || e);
    process.exit(1);
  }
})();
