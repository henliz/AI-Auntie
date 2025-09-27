// backend/routes/messages.js
import express from "express";
import { getDb } from "../mongo/mongoClient.js";

const router = express.Router();

// POST /api/messages
router.post("/", async (req, res) => {
  try {
    const db = getDb();
    const now = new Date();

    const messageDoc = {
      session_id: req.body.session_id ?? "demo-session-1",
      sender: req.body.sender ?? "user",
      text: req.body.text ?? "",
      topic: req.body.topic ?? null,
      intent: req.body.intent ?? null,
      created_at: now,
    };

    const { insertedId } = await db.collection("messages").insertOne(messageDoc);
    res.json({ ok: true, id: insertedId });
  } catch (err) {
    console.error("Error saving message:", err);
    res.status(500).json({ ok: false, error: "db_insert_failed" });
  }
});

export default router;
