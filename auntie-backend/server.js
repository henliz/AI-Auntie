import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

/**
 * Auntie Call Server
 * Twilio Media Streams  <->  OpenAI Realtime (voice)
 * Node 22.x (ESM)
 */

// Load env
dotenv.config();

const {
  OPENAI_API_KEY,
  OPENAI_REALTIME_MODEL,
  PORT,
  RENDER_EXTERNAL_URL
} = process.env;

// ---- Required envs ----
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment (.env)');
  process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyWs);

const SYSTEM_MESSAGE = `You are "Auntie"—a warm, calm, postpartum support companion.
- Default to kind, concise, practical advice that can be done immediately.
- Safety-first: if caller mentions self-harm or infant safety risk, gently advise contacting local emergency services and offer calming steps.
- Be encouraging, non-judgmental, culturally aware.
- Avoid medical diagnosis; offer reputable resources when needed.`;

// (Optional) log selected OpenAI event types to keep logs readable
const LOG_EVENT_TYPES = new Set([
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
  'session.updated'
]);

// ---- Server ----
const fastify = Fastify({ logger: true });
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

// Healthcheck
fastify.get('/', async (_, reply) => {
  reply.send({ ok: true, model: MODEL, voice: VOICE });
});

/**
 * Twilio webhook that returns TwiML to open a bidirectional media stream.
 * We compute the public base URL from RENDER_EXTERNAL_URL if present,
 * otherwise fall back to the Host header (useful for ngrok/dev).
 */
fastify.all('/incoming-call', async (request, reply) => {
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const scheme = (request.headers['x-forwarded-proto'] || 'https');
  const baseUrl = (RENDER_EXTERNAL_URL?.trim())
    ? RENDER_EXTERNAL_URL.trim().replace(/\/+$/,'')
    : `${scheme}://${host}`;

  // Convert https://... -> wss://...
  const wsUrl = baseUrl.replace(/^http/i, 'ws') + '/media-stream';

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">
    Connecting you to Auntie, your calm postpartum support companion.
  </Say>
  <Pause length="1"/>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">You can start speaking after the beep.</Say>
  <Play>https://api.twilio.com/cowbell.mp3</Play>
  <Connect><Stream url="${wsUrl}" /></Connect>
</Response>`;

  reply.type('text/xml').send(twiml);
});

/**
 * WebSocket endpoint that Twilio Media Streams connects to.
 * It bridges audio between Twilio and OpenAI Realtime WebSocket.
 */
fastify.register(async (f) => {
  f.get('/media-stream', { websocket: true }, (connection, req) => {
    f.log.info('Twilio connected to /media-stream');

    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    // Connect to OpenAI Realtime WS
    const openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    // Keepalive for long calls
    let pingInterval = null;
    const startPing = () => {
      if (pingInterval) return;
      pingInterval = setInterval(() => {
        try { openAiWs.ping(); } catch (_) {}
      }, 15000);
    };
    const stopPing = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    };

    // Configure OpenAI realtime session
    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: MODEL,
          instructions: SYSTEM_MESSAGE,
          output_modalities: ['audio'],
          audio: {
            input: { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcmu' }, voice: VOICE }
          }
        }
      };
      f.log.info('Sending session.update');
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    // Handle barge-in: when caller starts speaking, trim any in-progress assistant audio
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (lastAssistantItem) {
          const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: Math.max(0, elapsedTime)
          };
          openAiWs.send(JSON.stringify(truncateEvent));
        }
        // Tell Twilio to clear the mixer buffers
        connection.send(JSON.stringify({ event: 'clear', streamSid }));
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Mark helper (used to sync/flush Twilio mixer)
    const sendMark = () => {
      if (!streamSid) return;
      const markEvent = { event: 'mark', streamSid, mark: { name: 'responsePart' } };
      connection.send(JSON.stringify(markEvent));
      markQueue.push('responsePart');
    };

    // ---- OpenAI WS lifecycle ----
    openAiWs.on('open', () => {
      f.log.info('Connected -> OpenAI Realtime');
      startPing();
      setTimeout(initializeSession, 100);
    });

    openAiWs.on('message', (buf) => {
      const txt = buf.toString('utf8');
      let data = null;
      try { data = JSON.parse(txt); } catch (e) {
        f.log.error({ e, txt }, 'OpenAI message JSON parse error'); return;
      }

      if (LOG_EVENT_TYPES.has(data.type)) f.log.info({ type: data.type }, 'OpenAI event');

      // Stream audio deltas from OpenAI to Twilio
      if (data.type === 'response.output_audio.delta' && data.delta) {
        const audioDelta = { event: 'media', streamSid, media: { payload: data.delta } };
        connection.send(JSON.stringify(audioDelta));

        if (!responseStartTimestampTwilio) {
          responseStartTimestampTwilio = latestMediaTimestamp;
        }
        if (data.item_id) lastAssistantItem = data.item_id;
        sendMark();
      }

      if (data.type === 'input_audio_buffer.speech_started') {
        handleSpeechStartedEvent();
      }
    });

    openAiWs.on('close', () => {
      stopPing();
      f.log.warn('Disconnected <- OpenAI Realtime');
    });

    openAiWs.on('error', (e) => f.log.error({ e }, 'OpenAI WS error'));

    // ---- Twilio -> server WS ----
    connection.on('message', (msg) => {
      let data = null;
      try { data = JSON.parse(msg); } catch (e) {
        f.log.error({ e, msg: String(msg) }, 'Twilio WS JSON parse error'); return;
      }

      switch (data.event) {
        case 'start':
          streamSid = data.start.streamSid;
          latestMediaTimestamp = 0;
          responseStartTimestampTwilio = null;
          f.log.info({ streamSid }, 'Twilio stream started');
          break;

        case 'media':
          // Forward audio to OpenAI input buffer
          latestMediaTimestamp = data.media.timestamp || latestMediaTimestamp;
          if (openAiWs.readyState === WebSocket.OPEN) {
            openAiWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: data.media.payload
            }));
          }
          break;

        case 'mark':
          if (markQueue.length > 0) markQueue.shift();
          break;

        case 'stop':
          f.log.info('Twilio stream stopped');
          try {
            if (openAiWs.readyState === WebSocket.OPEN) {
              openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            }
          } catch (_) {}
          break;

        default:
          f.log.debug({ event: data.event }, 'Twilio other event');
      }
    });

    connection.on('close', () => {
      try { if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close(); } catch (_) {}
      f.log.info('Twilio WS disconnected');
    });
  });
});

// Start server
fastify.listen({ port: SERVER_PORT, host: '0.0.0.0' })
  .then(() => fastify.log.info(`Auntie server listening (server.js) on ${SERVER_PORT}`))
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });