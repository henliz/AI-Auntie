import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const systemInstruction = fs.readFileSync("ai/prompts/router.system.md","utf8");
const triageSchema = JSON.parse(fs.readFileSync("ai/triage.schema.json","utf8"));
const userText = "Baby won’t latch for 10 minutes—normal?";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

// Try a safe model first, then fall back to a v1beta-friendly one on 404
const MODEL_CANDIDATES = ["gemini-1.5-flash-8b", "gemini-1.5-flash-001"];

async function tryRoute(modelName) {
  console.log("MODEL:", modelName);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
    tools: [{ functionDeclarations: [triageSchema] }]
  });

  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: userText }] }],
    toolConfig: { functionCallingConfig: { mode: "ANY" } }
  });

  // Prefer function call output; else parse raw JSON
  const call = res.response.functionCalls?.[0];
  let routed = call?.args;
  if (!routed) {
    const txt = res.response.text().trim()
      .replace(/```json/gi, "").replace(/```/g, "")
      .replace(/^[^{\[]+/, "").replace(/[^}\]]+$/, "");
    routed = JSON.parse(txt);
  }
  return routed;
}

(async () => {
  for (const name of MODEL_CANDIDATES) {
    try {
      const routed = await tryRoute(name);
      console.log("USER:", userText);
      console.log("ROUTED:", routed);
      if (!["COMFORT","RESOURCE","ESCALATE"].includes(routed.intent)) {
        throw new Error("Invalid intent");
      }
      process.exit(0);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/404|Not Found|not found/i.test(msg)) {
        console.warn("Model 404 — trying next candidate…");
        continue; // try the next model
      }
      console.error("Routing error:", msg);
      if (e?.status || e?.statusText) console.error("HTTP:", e.status, e.statusText);
      process.exit(1);
    }
  }
  console.error("All model candidates failed (404).");
  process.exit(1);
})();
