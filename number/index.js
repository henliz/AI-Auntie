import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

// Load environment variables
dotenv.config();

// Env
const { OPENAI_API_KEY, RENDER_DOMAIN, SELF_ORIGIN } = process.env;
if (!OPENAI_API_KEY) {
  console.error('Missing OpenAI API key. Please set it in the .env file.');
  process.exit(1);
}

// Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const VOICE = 'alloy';
const PORT = process.env.PORT || 5050;
const LOG_EVENT_TYPES = [
  'error',
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
  'session.updated',
];
const SHOW_TIMING_MATH = false;

// -----------------------------
// Basic Routes
// -----------------------------
fastify.get('/', async (_request, reply) => {
  reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Twilio webhook that starts the call and opens a WS back to /media-stream
fastify.all('/incoming-call', async (request, reply) => {
  const streamHost = RENDER_DOMAIN || request.headers.host; // e.g., <app>.onrender.com
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>
    Please hold on just a moment while we bring Auntie to the phone. She’s so excited to chat with you.
  </Say>
  <Pause length="1"/>
  <Say>Hey honey, what's going on?</Say>
  <Connect>
    <Stream url="wss://${streamHost}/media-stream" />
  </Connect>
</Response>`;
  reply.type('text/xml').send(twimlResponse);
});

// -----------------------------
// Gemini gateway (stub)
// -----------------------------
fastify.post('/gemini/query', async (request, reply) => {
  try {
    const { query, context = {} } = request.body || {};

    // TODO: replace with your real Gemini+Snowflake call:
    // const { answer, sources } = await callGemini({ query, context });

    const answer = `Stubbed Gemini answer for: "${query}"`;
    const sources = ['snowflake:replace-me'];

    return reply.send({
      answer,
      sources,
      meta: { retrieved_at: new Date().toISOString(), context }
    });
  } catch (e) {
    request.log.error(e);
    return reply.code(500).send({ error: String(e) });
  }
});

fastify.get('/gemini/test', async (_req, reply) => {
  reply.type('text/html').send(`
<!doctype html><meta charset="utf-8">
<h1>Gemini Query Tester</h1>
<input id="q" value="current average wait time?" style="width:400px"/>
<button onclick="go()">Send</button>
<pre id="out"></pre>
<script>
async function go(){
  const r = await fetch('/gemini/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:document.getElementById('q').value})});
  document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2);
}
</script>`);
});

// -----------------------------
// WebSocket: Twilio <-> OpenAI Realtime
// Mode: Gemini-first (OpenAI = ASR+TTS only)
// -----------------------------
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('Client connected');

    // Per-connection state
    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseInFlight = false;
    let currentTranscript = '';
    let responseStartTimestampTwilio = null;

    // OpenAI as TTS+ASR only
    const TTS_SYSTEM = `
You are a TTS renderer and transcriber.
- DO NOT invent or paraphrase content.
- When asked to speak, read the provided text VERBATIM.
- When asked to transcribe, return ONLY the raw transcript text with no extra words.
`.trim();

    // Connect to OpenAI Realtime WS
    const openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=gpt-realtime&temperature=0`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['audio','text'],
          audio: {
            input: { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcmu' }, voice: VOICE }
          },
          instructions: TTS_SYSTEM
          // no tools — Gemini authors words via server
        }
      };
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    // Helper: send "mark" packets to Twilio
    const sendMark = () => {
      if (!streamSid) return;
      const markEvent = {
        event: 'mark',
        streamSid,
        mark: { name: 'responsePart' }
      };
      connection.socket.send(JSON.stringify(markEvent));
      markQueue.push('responsePart');
    };

    // Handle barge-in (caller starts speaking while we play audio)
    const handleSpeechStartedEvent = () => {
      if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
        const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
        if (SHOW_TIMING_MATH) {
          console.log(`Truncate elapsed: ${latestMediaTimestamp} - ${responseStartTimestampTwilio} = ${elapsedTime}ms`);
        }

        if (lastAssistantItem) {
          const truncateEvent = {
            type: 'conversation.item.truncate',
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: elapsedTime
          };
          openAiWs.send(JSON.stringify(truncateEvent));
        }

        // Clear Twilio playback buffer
        connection.socket.send(JSON.stringify({ event: 'clear', streamSid }));

        // Reset
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestampTwilio = null;
      }
    };

    // ----- Twilio -> OpenAI audio (input) -----
    connection.socket.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }

      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        console.log('Twilio stream started:', streamSid);
        responseStartTimestampTwilio = null;
        latestMediaTimestamp = 0;
        return;
      }

      if (msg.event === 'media' && msg.media?.payload) {
        openAiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: msg.media.payload // base64 PCMU
        }));
        latestMediaTimestamp = Number(msg.media.timestamp) || latestMediaTimestamp;
        return;
      }

      if (msg.event === 'mark') {
        if (markQueue.length > 0) markQueue.shift();
        return;
      }

      if (msg.event === 'stop') {
        console.log('Twilio stream stopped:', streamSid);
        return;
      }
    });

    // ----- OpenAI events: ASR -> Gemini -> TTS -----
    openAiWs.on('open', () => {
      console.log('Connected to the OpenAI Realtime API');
      setTimeout(initializeSession, 100);
    });

    openAiWs.on('message', async (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (LOG_EVENT_TYPES.includes(msg.type)) console.log('OpenAI event:', msg.type);

      // End of caller speech -> commit audio & request transcription (text only)
      if (msg.type === 'input_audio_buffer.speech_stopped') {
        openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        currentTranscript = '';
        openAiWs.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['text'],
            metadata: { kind: 'transcription' },
            instructions: 'Transcribe the caller’s last utterance EXACTLY. Return ONLY the raw transcript.'
          }
        }));
        return;
      }

      // Barge-in: caller started speaking
      if (msg.type === 'input_audio_buffer.speech_started') {
        handleSpeechStartedEvent();
        return;
      }

      // Collect transcription deltas
      if (msg.type === 'response.output_text.delta' && msg.response?.metadata?.kind === 'transcription') {
        currentTranscript += (msg.delta || '');
        return;
      }

      // Transcription complete -> call Gemini -> ask OpenAI to speak VERBATIM
      if (msg.type === 'response.completed' && msg.response?.metadata?.kind === 'transcription') {
        if (responseInFlight) return;
        responseInFlight = true;

        try {
          const base = SELF_ORIGIN || `http://127.0.0.1:${PORT}`;
          const r = await fetch(`${base}/gemini/query`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              query: currentTranscript,
              context: { streamSid, ts: Date.now() }
            })
          });
          const { answer } = await r.json();

          openAiWs.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio'],
              metadata: { kind: 'tts' },
              instructions: `Read this VERBATIM:\n${answer}`
            }
          }));
        } catch (e) {
          console.error('Gemini fetch error:', e);
          openAiWs.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio'],
              instructions: 'Sorry—our data service had a hiccup. Please try that again.'
            }
          }));
        } finally {
          currentTranscript = '';
          responseInFlight = false;
        }
        return;
      }

      // Stream audio back to Twilio as OpenAI generates it
      if (msg.type === 'response.output_audio.delta' && msg.delta && streamSid) {
        connection.socket.send(JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: msg.delta }
        }));

        // First delta from a new response starts the elapsed timer
        if (!responseStartTimestampTwilio) {
          responseStartTimestampTwilio = latestMediaTimestamp;
          if (SHOW_TIMING_MATH) {
            console.log(`Set start timestamp: ${responseStartTimestampTwilio}ms`);
          }
        }

        if (msg.item_id) lastAssistantItem = msg.item_id;
        sendMark();
        return;
      }
    });

    // Cleanup
    connection.socket.on('close', () => {
      try { openAiWs.close(); } catch {}
      console.log('Client disconnected');
    });
    openAiWs.on('close', () => {
      try { connection.socket.close(); } catch {}
      console.log('Disconnected from the OpenAI Realtime API');
    });
    openAiWs.on('error', (err) => console.error('OpenAI WS error:', err));
  });
});

// -----------------------------
// Boot
// -----------------------------
// Start server (local: 5050, Render: $PORT)
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
