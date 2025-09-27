import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- load prompt + schema
const systemInstruction = fs.readFileSync("ai/prompts/router.system.md","utf8");
const triageSchema = JSON.parse(fs.readFileSync("ai/triage.schema.json","utf8"));

// --- test input
const userText = "Baby won’t latch for 10 minutes—normal?";

// --- key + model (HARD-CODED to safe model)
const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

// Use a widely available model. If this 404s in your project, we’ll try -001 next.
const modelName = "gemini-1.5-flash-8b";
console.log("MODEL:", modelName);

const genAI = new GoogleGenerativeAI(apiKey);

async function main() {
  let model;
  try {
    model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction,
      tools: [{ functionDeclarations: [triageSchema] }]
    });
  } catch (e) {
    console.error("getGenerativeModel error:", e?.message || e);
    process.exit(1);
  }

  try {
    const res = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userText }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY" } }
    });

    let routed;
    const call = res.response.functionCalls?.[0];
    if (call?.name === triageSchema.name && call.args) routed = call.args;
    else { try { routed = JSON.parse(res.response.text()); } catch { routed = null; } }

    console.log("USER:", userText);
    console.log("ROUTED:", routed);

    if (!routed || !["COMFORT","RESOURCE","ESCALATE"].includes(routed.intent)) {
      console.error("Routing invalid or missing intent");
      process.exit(1);
    }
  } catch (e) {
    console.error("generateContent error:", e?.message || e);
    // print extra details if available
    if (e?.status || e?.statusText) console.error("HTTP:", e.status, e.statusText);
    process.exit(1);
  }
}
main();
