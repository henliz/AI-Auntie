// backend/shared/dbHelpers.js
import crypto from "crypto";
import { getDb } from "../mongo/mongoClient.js";

// ---------- Users ----------
export const hashPhone = (raw = "") =>
  crypto.createHash("sha256").update((process.env.HASH_SALT || "") + raw).digest("hex");

export async function ensureUser(user_hash) {
  const db = await getDb();
  await db.collection("users").updateOne(
    { user_hash },
    { $setOnInsert: { user_hash, created_at: new Date(), context: {} } },
    { upsert: true }
  );
}

export async function getUserContext(user_hash) {
  const db = await getDb();
  const u = await db.collection("users").findOne({ user_hash }, { projection: { context: 1 } });
  return u?.context || {};
}

export async function updateUserContext(user_hash, contextPatch = {}) {
  const db = await getDb();
  const $set = {};
  for (const [k, v] of Object.entries(contextPatch)) $set[`context.${k}`] = v;
  if (Object.keys($set).length) {
    await db.collection("users").updateOne({ user_hash }, { $set });
  }
}

// ---------- Sessions ----------
export async function ensureSession(session_id, user_hash) {
  const db = await getDb();
  await db.collection("sessions").updateOne(
    { session_id },
    { $setOnInsert: { session_id, user_hash, created_at: new Date() } },
    { upsert: true }
  );
}

// ---------- Messages ----------
export async function saveMessage(doc) {
  const db = await getDb();
  const payload = {
    session_id: doc.session_id,
    sender: doc.sender,               // "user" | "auntie" | "system"
    text: doc.text,
    channel: doc.channel || "sms",
    intent: doc.intent ?? null,
    topic: doc.topic ?? null,
    latency_ms: doc.latency_ms ?? null,
    created_at: doc.created_at ? new Date(doc.created_at) : new Date(),
    meta: doc.meta || {},
  };
  return db.collection("messages").insertOne(payload);
}

// Alias kept for compatibility
export const logMessage = saveMessage;

export async function getRecentMessages(session_id, limit = 6) {
  const db = await getDb();
  return db
    .collection("messages")
    .find({ session_id })
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
}
