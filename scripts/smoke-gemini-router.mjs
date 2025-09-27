import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const systemInstruction = fs.readFileSync("ai/prompts/router.system.md","utf8");
const triageSchema = JSON.parse(fs.readFileSync("ai/triage.schema.json","utf8"));
const userText = "Baby won’t latch for 10 minutes—normal?";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

// Use a universally available model
const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash-8b";

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

let routed;
const call = res.response.functionCalls?.[0];
if (call?.name === triageSchema.name && call.args) routed = call.args;
else { try { routed = JSON.parse(res.response.text()); } catch { routed = { intent:"RESOURCE", topic:"other", red_flags:[], confidence:0.5 }; } }

console.log("MODEL:", modelName);
console.log("USER:", userText);
console.log("ROUTED:", routed);
if (!["COMFORT","RESOURCE","ESCALATE"].includes(routed.intent)) process.exit(1);
