import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const systemInstruction = fs.readFileSync("ai/prompts/router.system.md","utf8");
const triageSchema = JSON.parse(fs.readFileSync("ai/triage.schema.json","utf8"));
const userText = "Baby won’t latch for 10 minutes—normal?";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

// Try multiple IDs that cover v1beta + legacy
const CANDIDATES = [
  "gemini-pro",             // legacy, commonly available on v1beta
  "gemini-1.0-pro",         // some projects expose this
  "gemini-1.5-flash-001",   // older 1.5
  "gemini-1.5-flash",       // alias → may map to -002 (can 404)
  "gemini-1.5-flash-8b"     // new-ish, sometimes blocked on v1beta
];

function parseJsonLoose(s) {
  return JSON.parse(
    s.trim()
     .replace(/```json/gi,"").replace(/```/g,"")
     .replace(/^[^{\[]+/, "").replace(/[^}\]]+$/, "")
  );
}

async function tryRoute(modelName) {
  console.log("MODEL:", modelName);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    tools: [{ functionDeclarations: [triageSchema] }]
  });

  const res = await model.generateContent({
    contents: [{
      role: "user",
      parts: [{ text: `Return ONLY JSON {intent,topic,red_flags,confidence}.\nUser: "${userText}"` }]
    }],
    toolConfig: { functionCallingConfig: { mode: "ANY" } }
  });

  let routed = res.response.functionCalls?.[0]?.args ?? null;
  if (!routed) routed = parseJsonLoose(res.response.text());
  return routed;
}

(async () => {
  for (const name of CANDIDATES) {
    try {
      const routed = await tryRoute(name);
      console.log("USER:", userText);
      console.log("ROUTED:", routed);
      if (!["COMFORT","RESOURCE","ESCALATE"].includes(routed.intent)) throw new Error("Invalid intent");
      process.exit(0);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/404|Not\s*Found|model .* not found|unsupported/i.test(msg)) {
        console.warn("Model not available here — trying next candidate…");
        continue;
      }
      console.error("Routing error:", msg);
      if (e?.status || e?.statusText) console.error("HTTP:", e.status, e.statusText);
      process.exit(1);
    }
  }
  console.error("All model candidates failed (404).");
  process.exit(1);
})();
