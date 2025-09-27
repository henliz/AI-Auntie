// server.js — Twilio Media Streams ⇄ OpenAI Realtime (Fastify)
// Build: npm install   |   Start: node server.js
// Env (Render): OPENAI_API_KEY, OPENAI_REALTIME_MODEL, PUBLIC_BASE_URL, OA_VOICE, OA_TEMPERATURE

import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

// ---------- Config ----------
const PORT = process.env.PORT || 5050;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment.');
  process.exit(1);
}
const MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
const VOICE = process.env.OA_VOICE || 'alloy';
const TEMPERATURE = Number(process.env.OA_TEMPERATURE || 0.8);
const SYSTEM_MESSAGE =
  process.env.SYSTEM_MESSAGE ||
  'You are a helpful, bubbly phone assistant. Keep answers concise, warm, and lightly humorous.';

// ---------- Fastify app ----------
const fastify = Fastify({ logger: false });
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

// quiet health-probe spam
fastify.addHook('onRequest', (req, _reply, done) => {
  if (req.url !== '/health') console.log(`[REQ] ${req.method} ${req.url}`);
  done();
});

// health + root
fastify.get('/health', async (_req, reply) => reply.code(200).type('text/plain').send('OK'));
fastify.get('/', async (_req, reply) => reply.send({ ok: true }));

// ---------- Voice webhook: return TwiML with a WSS media stream ----------
fastify.all('/incoming-call', async (request, reply) => {
  // PUBLIC_BASE_URL example: https://auntie-backend.onrender.com
  const rawBase = process.env.PUBLIC_BASE_URL || `https://${request.headers.host}`;
  // normalize: no trailing slash, force wss://
  const baseNoSlash = rawBase.replace(/\/+$/, '');
  const wss = baseNoSlash
    .replace(/^ws:/, 'https:')
    .replace(/^wss:/, 'https:')
    .replace(/^http:/, 'https:')
    .replace(/^https:/, 'wss:');

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">Connecting you to the A. I. voice assistant.</Say>
  <Connect>
    <Stream url="${wss}/media-stream" />
  </Connect>
</Response>`;

  reply.type('text/xml').send(twiml);
});

// ---------- Media Stream WS: Twilio <-> OpenAI bridge ----------
fastify.get('/media-stream', { websocket: true }, (connection) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  // state
  let streamSid = null;
  let callSid = null;
  let oaOpen = false;
  let greeted = false;
  let responseInFlight = false;
  let hasBu
