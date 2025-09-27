// backend/routes/chat.js
import { Router } from "express";
import {
  hashPhone,
  ensureUser,
  ensureSession,
  logMessage,
  getUserContext,
  updateUserContext,
  getRecentMessages, // <-- history helper from shared/dbHelpers.js
} from "../shared/dbHelpers.js";
import { brainReply } from "../ai/brain.js";
// Optional Snowflake resource lookup (uncomment when ready):
// import { fetchTopResources } from "../snowflake/resources.js";

const router = Router();

/**
 * POST /api/chat
 * body: { from: "+15555550123", text: "hi auntie" }
 * flow:
 *  1) upsert user + session
 *  2) log user msg
 *  3) read context + short history
 *  4) call Gemini (brainReply)
 *  5) (optional) if RESOURCE -> look up resources
 *  6) log auntie msg (+ resources)
 *  7) patch user context
 *  8) return AI reply
 */
router.post("/", async (req, res) => {
  try {
    const from = req.body.from;
    const text = req.body.text;

    if (!from || !text) {
      return res.status(400).json({ ok: false, error: "from_and_text_required" });
    }

    // 1) Identify user by hashed phone; ensure user + session
    const user_hash = hashPhone(from);
    await ensureUser(user_hash);
    const session_id = await ensureSession(user_hash);

    // 2) Log user's message
    await logMessage({ session_id, sender: "user", text });

    // 3) Read minimal memory (context + short session history)
    const user = await getUserContext(user_hash);              // { context?, region? }
    const history = await getRecentMessages(session_id, 6);    // last few turns

    // 4) Call Gemini
    const ai = await brainReply({
      text,
      context: user.context || {},
      region: user.region || null,
      history,
    });

    // 5) (Optional) Fetch resources from Snowflake if needed
    // let resources = [];
    // if (ai.intent === "RESOURCE") {
    //   resources = await fetchTopResources(ai.topic, ai.region || user.region);
    // }

    // 6) Log Auntie's reply (include resources if you enabled them)
    await logMessage({
      session_id,
      sender: "auntie",
      intent: ai.intent,
      topic: ai.topic,
      red_flags: ai.red_flags || [],
      // resources, // <-- uncomment if using Snowflake above
      text: ai.reply_text,
    });

    // 7) Patch user context if the model suggested safe updates
    if (ai.updates?.context) {
      await updateUserContext(user_hash, ai.updates.context);
    }

    // 8) Return the AI reply to the client
    return res.json({
      ok: true,
      reply: ai.reply_text,
      intent: ai.intent,
      topic: ai.topic,
      // resources, // <-- if you enabled Snowflake
    });
  } catch (err) {
    console.error("chat route failed:", err);
    return res.status(500).json({ ok: false, error: "chat_failed" });
  }
});

export default router;
