// index.js
import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import cors from '@fastify/cors';

// ✅ Gemini SDK (correct package + import)
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

// -----------------------------
// Env & constants
// -----------------------------
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  console.error('Missing OpenAI API key. Please set OPENAI_API_KEY in .env');
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
if (!GEMINI_API_KEY) {
  console.error('Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

const VOICE = 'alloy';
const TEMPERATURE = 0.8;
const PORT = Number(process.env.PORT || 5050);

// Resolve a public base URL for internal fetches (Render or local)
function getExternalBase() {
  return (
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RENDER_DOMAIN ? `https://${process.env.RENDER_DOMAIN}` : `http://localhost:${PORT}`)
  );
}

// -----------------------------
// Fastify setup
// -----------------------------
const fastify = Fastify();
await fastify.register(cors, { origin: true });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// -----------------------------
// Base system message (for OpenAI Realtime)
// -----------------------------
const BASE_SYSTEM_MESSAGE =
  'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.';

// Loggable event types (OpenAI Realtime)
const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
  'session.updated'
];

const SHOW_TIMING_MATH = false;

// -----------------------------
// Basic routes
// -----------------------------
fastify.get('/', async (_req, reply) => {
  reply.send({ message: 'Twilio Media Stream Server is running!', provider: 'OpenAI Realtime + Gemini' });
});

// Twilio webhook → WS back to /media-stream
fastify.all('/incoming-call', async (request, reply) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">
    Please wait while we connect your call to the A. I. voice assistant, powered by Twilio and the Open A I Realtime API
  </Say>
  <Pause length="1"/>
  <Say voice="Google.en-US-Chirp3-HD-Aoede">O.K. you can start talking!</Say>
  <Connect>
    <Stream url="wss://${request.headers.host}/media-stream" />
  </Connect>
</Response>`;
  reply.type('text/xml').send(twimlResponse);
});

// -----------------------------
// Gemini: client + route
// -----------------------------
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const gemini = genAI.getGenerativeModel({ model: GEMINI_MODEL });

/**
 * POST /gemini/query
 * Body: { query: string, context?: object, json?: boolean }
 * - If json=true we ask Gemini to respond as JSON (useful for triage/classification).
 */
fastify.post('/gemini/query', async (request, reply) => {
  try {
    const { query, context = {}, json = false } = request.body || {};
    if (!query || typeof query !== 'string') {
      return reply.code(400).send({ error: 'Missing "query" string in body.' });
    }

    const res = await gemini.generateContent({
      contents: [
        // You can prepend a system-style hint here if you want stricter behavior.
        { role: 'user', parts: [{ text: query }] }
      ],
      generationConfig: json ? { responseMimeType: 'application/json' } : undefined
    });

    const text = res?.response?.text?.() ?? '';
    return reply.send({
      answer: text,
      sources: [],
      meta: { model: GEMINI_MODEL, retrieved_at: new Date().toISOString(), context }
    });
  } catch (e) {
    request.log.error(e);
    return reply.code(500).send({ error: 'gemini_request_failed', detail: String(e?.message || e) });
  }
});

// Quick in-browser tester
fastify.get('/gemini/test', async (_req, reply) => {
  reply.type('text/html').send(`
<!doctype html><meta charset="utf-8">
<h1>Gemini Query Tester</h1>
<input id="q" value="Say hi in a warm, auntie tone." style="width:400px"/>
<label><input id="json" type="checkbox"> JSON mode</label>
<button onclick="go()">Send</button>
<pre id="out"></pre>
<script>
async function go(){
  const r = await fetch('/gemini/query',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query:document.getElementById('q').value, json:document.getElementById('json').checked})
  });
  document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2);
}
</script>`);
});

// -----------------------------
// WebSocket: Twilio <-> OpenAI Realtime
// -----------------------------
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('Client connected');

    // Connection-specific state
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    // Connect to OpenAI Realtime WS
    const openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=gpt-realtime&temperature=${TEMPERATURE}`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    // Build a system message that nudges tool usage
    const SYSTEM_MESSAGE = `
${BASE_SYSTEM_MESSAGE}

# Tool Use
- When the caller asks for facts, metrics, schedules, or anything that may rely on organizational/internal data, CALL the function "queryGemini" with a concise question (and optional user context).
- After the tool returns, summarize results conversationally for the caller. If sources are provided, refer to them in plain language (e.g., "from our records").
- If the tool errors or times out, apologize briefly and suggest one actionable alternative, then continue the conversation.
`.trim();

    // Configure session
    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['audio'],
          audio: {
            input: { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcmu' }, voice: VOICE }
          },
          instructions: SYSTEM_MESSAGE,
          tools: [
            {
              type: 'function',
              name: 'queryGemini',
              description:
                'Query organization knowledge via Gemini (or general Q&A). Use for accurate, up-to-date internal/external data.',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Natural-language question.' },
                  user_context: {
                    type: 'object',
                    description: 'Optional caller/session metadata.',
                    additionalProperties: true
                  }
                },
                required: ['query']
              }
            }
          ]
        }
      };

      console.log('Sending session update:', JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    // Optional: have AI speak first
    // const sendInitialConversationItem = () => {
    //   const initialConversationItem = {
    //     type: 'conversation.item.create',
    //     item: {
    //       type: 'message',
    //       role: 'user',
    //       content: [{ type: 'input_text', text: 'Say hello to the caller and explain briefly what you can do.' }]
    //     }
    //   };
    //   openAiWs.send(JSON.stringify(initialConversationItem));
    //   openAiWs.send(JSON.stringify({ type: 'response.create' }));
    // };

    // Handle interruption when the caller starts speaking
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (lastAssistantItem) {
          const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime
          };
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        connection.send(JSON.stringify({ event: 'clear', streamSid }));
        // Reset
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // Mark helper so we know when playback finished
    const sendMark = (connection, streamSid) => {
      if (streamSid) {
        const markEvent = { event: 'mark', streamSid, mark: { name: 'responsePart' } };
        connection.send(JSON.stringify(markEvent));
        markQueue.push('responsePart');
      }
    };

    // OpenAI WS events
    openAiWs.on('open', () => {
      console.log('Connected to the OpenAI Realtime API');
      setTimeout(initializeSession, 100);
    });

    openAiWs.on('message', async (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

        // Tool/function call from the model
        if (response.type === 'response.function_call' && response.name === 'queryGemini') {
          const { call_id } = response;
          const { query, user_context } = response.arguments || {};

          try {
            const base = getExternalBase();
            const res = await fetch(`${base}/gemini/query`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ query, context: user_context || {} })
            });
            const dataOut = await res.json();

            openAiWs.send(
              JSON.stringify({
                type: 'response.function_call_output',
                call_id,
                output: JSON.stringify(dataOut) // must be a string
              })
            );
          } catch (err) {
            openAiWs.send(
              JSON.stringify({
                type: 'response.function_call_output',
                call_id,
                output: JSON.stringify({ error: String(err) })
              })
            );
          }
          return; // avoid double-processing
        }

        // Stream audio back to Twilio
        if (response.type === 'response.output_audio.delta' && response.delta) {
          const audioDelta = { event: 'media', streamSid, media: { payload: response.delta } };
          connection.send(JSON.stringify(audioDelta));

          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
          }

          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }

          sendMark(connection, streamSid);
        }

        if (response.type === 'input_audio_buffer.speech_started') {
          handleSpeechStartedEvent();
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error, 'Raw message:', data);
      }
    });

    // Incoming Twilio Media Stream frames
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'media':
            latestMediaTimestamp = data.media.timestamp;
            if (openAiWs.readyState === WebSocket.OPEN) {
              openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data.media.payload }));
            }
            break;
          case 'start':
            streamSid = data.start.streamSid;
            console.log('Incoming stream has started', streamSid);
            responseStartTimestampTwilio = null;
            latestMediaTimestamp = 0;
            break;
          case 'mark':
            if (markQueue.length > 0) markQueue.shift();
            break;
          default:
            console.log('Received non-media event:', data.event);
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error, 'Message:', message);
      }
    });

    // Cleanup
    connection.on('close', () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log('Client disconnected.');
    });

    openAiWs.on('close', () => console.log('Disconnected from the OpenAI Realtime API'));
    openAiWs.on('error', (error) => console.error('Error in the OpenAI WebSocket:', error));
  });
});

// -----------------------------
// Boot
// -----------------------------
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
