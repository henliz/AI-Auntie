import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "auntie";

let client;
let db;

export async function getDb() {
  if (!client) {
    client = new MongoClient(uri, { maxPoolSize: 10 });
    await client.connect();
    db = client.db(dbName);
    // Helpful indexes for your messages collection:
    await db.collection("messages").createIndex({ session_id: 1, created_at: -1 });
    await db.collection("messages").createIndex({ sender: 1, created_at: -1 });
  }
  return db;
}
