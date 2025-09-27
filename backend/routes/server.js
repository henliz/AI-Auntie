// backend/server.js
import express from "express";
import { connectToMongo } from "./mongo/mongoClient.js";
import messagesRouter from "./routes/messages.js";

const app = express();
app.use(express.json());

// Connect MongoDB first, then start server
connectToMongo().then(() => {
  app.use("/messages", messagesRouter);

  app.listen(3000, () => {
    console.log("🚀 Server running on http://localhost:3000");
  });
});
