import Fastify from 'fastify';
import WebSocket from 'ws';
import dotenv from 'dotenv';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

// Load environment variables
dotenv.config();

// OpenAI API key
const { OPENAI_API_KEY, RENDER_DOMAIN } = process.env;

if (!OPENAI_API_KEY) {
  console.error('Missing OpenAI API key. Please set it in the .env file.');
  process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE = `
You are Auntie — a sweet, kind, and bubbly AI support voice with caring, nurturing qualities. 
You feel like a warm grandma or aunt: empathetic, reassuring, and culturally sensitive.

Scope & Boundaries:
- Share general, evidence-informed guidance and emotional support.
- Encourage care-seeking when needed. Never diagnose, prescribe meds, or interpret labs.
- Use thresholds, not absolutes (e.g., “fever 38 °C / 100.4 °F or higher”).
- If red flags arise, escalate gently with supportive language.

Core Tone:
- Empathy first: validate with 1 short sentence.
- Plain language: short, clear sentences.
- Strength-based: normalize struggle, reduce guilt/shame.
- Inclusive: “breast/chestfeeding,” “partner/support person,” no judgment.

Channel Style:
- SMS: 2–4 short sentences + up to 3 bullets (≤200 chars each).
- Voice: 2 short paragraphs + up to 3 bullets; warm, steady cadence.

Patterns:
1) Acknowledge → “That sounds tough, love, and it makes sense you feel this way.”
2) Normalize or clarify → “Many people feel sore for 1–2 weeks and it usually eases.”
3) Give up to 3 doable steps.
4) Add safety line → “If this gets worse, new fever ≥38 °C, or unsafe feelings, please seek care.”
5) Check-back → “Would you like more ideas?” or “Does that feel helpful?”

Voice & Wording:
- Warmth: medium (gentle endearments like “love”).
- Directness: medium-high.
- Brevity: high for SMS, medium for voice.
- Agency: 1–3 clear, doable actions.
- Close: small check-back, never “Want me to text this?”
`;

const VOICE = 'coral';
const TEMPERATURE = 0.8;
const PORT = process.env.PORT || 5050;

// Events we want to log
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

// Root route
fastify.get('/', async (request, reply) => {
  reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Incoming call handler
fastify.all('/incoming-call', async (request, reply) => {
  // Prefer Render domain if provided, else use request.host (good for ngrok)
  const streamHost = RENDER_DOMAIN || request.headers.host;

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Say voice="Google.en-US-Sage">
        Please hold on just a moment while we bring Auntie to the phone. She’s so excited to chat with you.
      </Say>
      <Pause length="1"/>
      <Say voice="Google.en-US-Chirp3-HD-Aoede">Hey honey, what's going on?</Say>
      <Connect>
        <Stream url="wss://${streamHost}/media-stream" />
      </Connect>
    </Response>`;

  reply.type('text/xml').send(twimlResponse);
});

// WebSocket for media stream
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('Client connected');

    let streamSid = null;
    let latestMediaTimestamp = 0;
    let lastAssistantItem = null;
    let markQueue = [];
    let responseStartTimestampTwilio = null;

    const openAiWs = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=gpt-realtime&temperature=${TEMPERATURE}`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          output_modalities: ['audio'],
          audio: {
            input: { format: { type: 'audio/pcmu' }, turn_detection: { type: 'server_vad' } },
            output: { format: { type: 'audio/pcmu' }, voice: VOICE },
          },
          instructions: SYSTEM_MESSAGE,
        },
      };

      console.log('Sending session update:', JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));
    };

    // OpenAI Realtime WS open
    openAiWs.on('open', () => {
      console.log('Connected to the OpenAI Realtime API');
      setTimeout(initializeSession, 100);
    });

    // Handle OpenAI messages
    openAiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

        if (response.type === 'response.output_audio.delta' && response.delta) {
          const audioDelta = {
            event: 'media',
            streamSid: streamSid,
            media: { payload: response.delta },
          };
          connection.send(JSON.stringify(audioDelta));

          if (!responseStartTimestampTwilio) {
            responseStartTimestampTwilio = latestMediaTimestamp;
            if (SHOW_TIMING_MATH)
              console.log(`Setting start timestamp for new response: ${responseStartTimestampTwilio}ms`);
          }

          if (response.item_id) {
            lastAssistantItem = response.item_id;
          }

          // send a mark
          if (streamSid) {
            const markEvent = {
              event: 'mark',
              streamSid: streamSid,
              mark: { name: 'responsePart' },
            };
            connection.send(JSON.stringify(markEvent));
            markQueue.push('responsePart');
          }
        }

        if (response.type === 'input_audio_buffer.speech_started') {
          if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
            const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
            if (lastAssistantItem) {
              const truncateEvent = {
                type: 'conversation.item.truncate',
                item_id: lastAssistantItem,
                content_index: 0,
                audio_end_ms: elapsedTime,
              };
              openAiWs.send(JSON.stringify(truncateEvent));
            }

            connection.send(JSON.stringify({ event: 'clear', streamSid }));
            markQueue = [];
            lastAssistantItem = null;
            responseStartTimestampTwilio = null;
          }
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error, 'Raw message:', data);
      }
    });

    // Handle Twilio messages
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'media':
            latestMediaTimestamp = data.media.timestamp;
            if (openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload,
              };
              openAiWs.send(JSON.stringify(audioAppend));
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

// Start server (local: 5050, Render: $PORT)
fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});
