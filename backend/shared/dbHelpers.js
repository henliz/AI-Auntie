// backend/shared/dbHelpers.js
import crypto from "crypto";
import { getDb } from "../mongo/mongoClient.js";

// Hash the phone number with a salt (store only the hash)
export const hashPhone = (raw) =>
  crypto.createHash("sha256").update((process.env.HASH_SALT || "") + raw).digest("hex");

// Ensure a user doc exists (by hashed phone)
export async function ensureUser(user_hash) {
  const db = getDb();
  await db.collection("users").updateOne(
    { user_hash },
    { $setOnInsert: { user_hash, created_at: new Date() } },
    { upsert: true }
  );
}

// Find an open/recent session or create a new one
export async function ensureSession(user_hash) {
  const db = getDb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Prefer an open session in the last hour
  const existing = await db.collection("sessions").findOne({
    user_hash,
    started_at: { $gte: oneHourAgo },
    $or: [{ ended_at: null }, { ended_at: { $exists: false } }],
  });

  if (existing) return existing._id;

  const { insertedId } = await db.collection("sessions").insertOne({
    user_hash,
    started_at: new Date(),
    ended_at: null,
  });
  return insertedId;
}

// Log a message (adds created_at automatically)
export async function logMessage(doc) {
  const db = getDb();
  const { insertedId } = await db.collection("messages").insertOne({
    ...doc,
    created_at: new Date(),
  });
  return insertedId;
}

// Read minimal user context for personalization
export async function getUserContext(user_hash) {
  const db = getDb();
  const u = await db.collection("users").findOne(
    { user_hash },
    { projection: { context: 1, region: 1 } }
  );
  return u || {};
}

// Patch user.context without overwriting the whole object
export async function updateUserContext(user_hash, contextPatch = {}) {
  const db = getDb();
  const set = {};
  for (const [k, v] of Object.entries(contextPatch)) {
    set[`context.${k}`] = v;
  }
  if (Object.keys(set).length > 0) {
    await db.collection("users").updateOne({ user_hash }, { $set: set });
  }
}

// 🔹 NEW: fetch last N messages in this session (for model history)
export async function getRecentMessages(session_id, limit = 6) {
  const db = getDb();
  const arr = await db
    .collection("messages")
    .find({ session_id })
    .project({ _id: 0, sender: 1, text: 1, created_at
