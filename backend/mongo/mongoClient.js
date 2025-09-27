// backend/mongo/mongoClient.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let client;
let db;

export async function connectToMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await client.connect();
    db = client.db("auntie"); // database name
    console.log("✅ Connected to MongoDB Atlas");
  }
  return db;
}

export function getDb() {
  if (!db) throw new Error("❌ MongoDB not initialized. Call connectToMongo() first.");
  return db;
}
