fastify.get('/media-stream', { websocket: true }, (connection) => {
  console.log('────────────────────────────────────────────────────────');
  console.log('[Twilio] media stream connected');

  let streamSid = null;
  let callSid = null;
  let oaOpen = false;
  let greeted = false;
  let responseInFlight = false;
  let hasBufferedAudio = false;

  let framesSinceCommit = 0;
  const FRAMES_BEFORE_COMMIT = Number(process.env.FRAMES_BEFORE_COMMIT || 10);

  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}&temperature=${encodeURIComponent(TEMPERATURE)}`,
    'realtime',
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } }
  );

  const safeSendOA = (obj) => {
    if (oaOpen && oa.readyState === WebSocket.OPEN) oa.send(JSON.stringify(obj));
  };

  const maybeGreet = () => {
    if (!greeted && oaOpen && streamSid) {
      greeted = true;
      safeSendOA({ type: 'response.create', response: { modalities: ['audio','text'], instructions: "Hi! I'm listening—go ahead." } });
    }
  };

  const greeterTick = setInterval(() => { if (greeted) clearInterval(greeterTick); else maybeGreet(); }, 250);
  setTimeout(() => clearInterval(greeterTick), 5000);

  oa.on('open', () => {
    oaOpen = true;
    console.log('[OpenAI] websocket open');
    safeSendOA({
      type: 'session.update',
      session: {
        modalities: ['audio','text'],
        instructions: SYSTEM_MESSAGE,
        voice: VOICE,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        turn_detection: { type: 'server_vad' },
      },
    });
    maybeGreet();
  });

  oa.on('message', (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    if (msg.type === 'session.updated') console.log('[OpenAI] session.updated ok');
    if (msg.type === 'response.created') responseInFlight = true;
    if (msg.type === 'response.completed' || msg.type === 'response.done') responseInFlight = false;

    if (msg.type === 'input_audio_buffer.speech_stopped') {
      if (hasBufferedAudio) {
        safeSendOA({ type: 'input_audio_buffer.commit' });
        hasBufferedAudio = false;
        if (!responseInFlight) safeSendOA({ type: 'response.create', response: { modalities: ['audio','text'] } });
      }
    }

    if ((msg.type === 'response.audio.delta' || msg.type === 'response.output_audio.delta') && msg.delta && streamSid) {
      connection.socket.send(JSON.stringify({
        event: 'media',
        streamSid,
        media: { payload: msg.delta },
      }));
    }

    if (msg.type === 'error') console.error('[OpenAI] error event:', msg);
  });

  oa.on('error', (e) => console.error('[OpenAI] websocket error:', e?.message || e));
  oa.on('close', () => console.log('[OpenAI] websocket closed'));

  // 🔴 Use connection.socket for Twilio messages
  connection.socket.on('message', (raw) => {
    const text = raw.toString();
    if (!greeted && text) console.log('[Twilio] raw:', text.slice(0, 200));

    let m; try { m = JSON.parse(text); } catch { return; }
    switch (m.event) {
      case 'start':
        streamSid = m.start?.streamSid || streamSid;
        callSid  = m.start?.callSid  || callSid;
        console.log(`[Twilio] start: callSid=${callSid} streamSid=${streamSid}`);
        maybeGreet();
        break;

      case 'media':
        if (!oaOpen || oa.readyState !== WebSocket.OPEN) break;
        if (m.media?.payload) {
          safeSendOA({ type: 'input_audio_buffer.append', audio: m.media.payload });
          hasBufferedAudio = true;
          framesSinceCommit++;
          if (framesSinceCommit >= FRAMES_BEFORE_COMMIT) {
            safeSendOA({ type: 'input_audio_buffer.commit' });
            framesSinceCommit = 0;
          }
        }
        break;

      case 'stop':
        console.log('[Twilio] stop');
        try { oa.close(); } catch {}
        break;
    }
  });

  connection.socket.on('error', (e) => console.error('[WS] Twilio socket error:', e?.message || e));
  connection.socket.on('close', () => { try { oa.close(); } catch {} console.log('[Twilio] media stream closed'); });
});
