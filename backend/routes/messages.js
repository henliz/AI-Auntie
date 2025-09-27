// backend/routes/messages.js
import express from "express";
import { getDb } from "../mongo/mongoClient.js";

const router = express.Router();

// POST /messages → saves a message
router.post("/", async (req, res) => {
  try {
    const db = getDb();
    const now = new Date();

    const messageDoc = {
      session_id: req.body.session_id,
      sender: req.body.sender,   // "user" or "auntie"
      text: req.body.text,
      topic: req.body.topic,
      intent: req.body.intent,
      created_at: now,
    };

    await db.collection("messages").insertOne(messageDoc);
    res.json({ success: true, message: "Message saved", data: messageDoc });
  } catch (err) {
    console.error("Error saving message:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
