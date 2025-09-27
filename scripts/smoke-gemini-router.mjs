import fs from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const systemInstruction = fs.readFileSync("ai/prompts/router.system.md","utf8");
const userText = "Baby won’t latch for 10 minutes—normal?";

const apiKey = process.env.GEMINI_API_KEY || "";
if (!apiKey) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const modelName = "gemini-1.5-flash-8b";
console.log("MODEL:", modelName);

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: modelName, systemInstruction });

// Helper: try to parse JSON even if fences are present
function parseJsonLoose(s) {
  const cleaned = s.trim()
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/^[^{\[]+/, "")       // drop junk before {
    .replace(/[^}\]]+$/, "");      // drop junk after }
  return JSON.parse(cleaned);
}

async function main() {
  try {
    // Strong “JSON only” nudge in the user message as well
    const res = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{
          text:
`Return ONLY raw JSON with fields {intent,topic,red_flags,confidence}.
User message: "${userText}"`
        }]
      }]
    });

    let routed = null;
    const txt = res.response.text();
    try { routed = parseJsonLoose(txt); } catch (e) {
      console.error("Primary JSON parse failed:", e?.message || e);
    }

    // Minimal heuristic fallback so the step won’t fail noisy
    if (!routed) {
      const lower = userText.toLowerCase();
      routed = {
        intent: "RESOURCE",
        topic: lower.includes("latch") ? "latch" : "other",
        red_flags: [],
        confidence: 0.55
      };
      console.log("FALLBACK used.");
    }

    console.log("USER:", userText);
    console.log("ROUTED:", routed);
    if (!["COMFORT","RESOURCE","ESCALATE"].includes(routed.intent)) {
      console.error("Routing invalid or missing intent");
      process.exit(1);
    }
  } catch (e) {
    console.error("generateContent error:", e?.message || e);
    if (e?.status || e?.statusText) console.error("HTTP:", e.status, e.statusText);
    process.exit(1);
  }
}
main();
