// backend/server.js
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import dotenv from "dotenv";
import messagesRoutes from "./routes/messages.js";

dotenv.config();

const app = Fastify();

// Register plugins
await app.register(formbody);

// Register your SMS routes
await app.register(messagesRoutes);

// Health check endpoint (optional but useful)
app.get("/health", async () => ({ ok: true }));

// Start server
const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`✅ Server listening on ${port}`);
});
