import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const systemInstruction = fs.readFileSync("ai/prompts/router.system.md","utf8");
const triageSchema = JSON.parse(fs.readFileSync("ai/triage.schema.json","utf8"));
const userText = "Baby won’t latch for 10 minutes—normal?";

// Preferred order; we’ll filter this by what your key actually lists
const PREFERRED = [
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash-001",
  "gemini-1.5-flash",
  "gemini-1.0-pro",
  "gemini-pro" // legacy alias on some accounts
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
    // As a last resort, grab *any* text model with generateContent capability
    const fallback = names.find(n => /gemini.*(pro|flash)/.test(n));
    return fallback || null;
  } catch (e) {
    console.warn("listModels failed, falling back to 1.0 pro:", e?.message || e);
    return "gemini-1.0-pro";
  }
}

function parseJsonLoose(s) {
  return JSON.parse(
    s.trim().replace(/```json/gi, "").replace(/```/g, "")
     .replace(/^[^{\[]+/, "").replace(/[^}\]]+$/, "")
  );
}

(async () => {
  const modelName = await pickModel();
  if (!modelName) { console.error("No usable models visible to this API key."); process.exit(1); }
  console.log("USING MODEL:", modelName);

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    tools: [{ functionDeclarations: [triageSchema] }]
  });

  try {
    const res = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: `Return ONLY JSON {intent,topic,red_flags,confidence}.\nUser: "${userText}"` }]
      }],
      toolConfig: { functionCallingConfig: { mode: "ANY" } }
    });

    let routed = res.response.functionCalls?.[0]?.args ?? null;
    if (!routed) routed = parseJsonLoose(res.response.text());

    console.log("USER:", userText);
    console.log("ROUTED:", routed);
    if (!["COMFORT","RESOURCE","ESCALATE"].includes(routed.intent)) throw new Error("Invalid intent");
    process.exit(0);
  } catch (e) {
    console.error("Routing error:", e?.message || e);
    if (e?.status || e?.statusText) console.error("HTTP:", e.status, e.statusText);
    process.exit(1);
  }
})();
