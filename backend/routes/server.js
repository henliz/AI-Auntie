// backend/server.js
import express from "express";
import dotenv from "dotenv";
import { connectToMongo } from "./mongo/mongoClient.js";

import messagesRouter from "./routes/messages.js";
import chatRouter from "./routes/chat.js";

dotenv.config();

async function start() {
  const app = express();

  // Parsers: JSON for your app, urlencoded for Twilio-style posts (safe to keep both)
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Connect to Mongo once at startup
  await connectToMongo();

  // Routes
  app.use("/api/messages", messagesRouter); // simple smoke-test insert
  app.use("/api/chat", chatRouter);         // Mongo <-> Gemini chat flow

  // Health check
  app.get("/health", (_, res) => res.send("ok"));

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
