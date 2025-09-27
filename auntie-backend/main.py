import os, json, base64, asyncio, websockets
from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.websockets import WebSocketDisconnect
from twilio.twiml.voice_response import VoiceResponse, Connect
from dotenv import load_dotenv

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
PORT = int(os.getenv("PORT", "5050"))

SYSTEM_MESSAGE = (
    "You are Auntie, a warm, evidence-based postpartum support voice. "
    "Be brief, kind, and practical. No URLs aloud—keep turns short."
)
VOICE = "aria"  # try 'verse' if you prefer
LOG_TYPES = {
    "response.output_audio.delta",
    "response.completed",
    "session.updated",
    "rate_limits.updated",
}

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY missing in environment")

app = FastAPI()

@app.get("/", response_class=JSONResponse)
async def root():
    return {"message": "Twilio Media Stream server up"}

@app.api_route("/incoming-call", methods=["GET", "POST"])
async def incoming_call(request: Request):
    """
    Returns TwiML that connects the call to our WS stream.
    (No <Say>/<Play> so the first voice you hear is OpenAI.)
    """
    host = request.url.hostname
    scheme = "wss"  # Twilio requires secure WS
    ws_url = f"{scheme}://{host}/media-stream"

    vr = VoiceResponse()
    connect = Connect()
    connect.stream(url=ws_url)
    vr.append(connect)
    return HTMLResponse(str(vr), media_type="application/xml")

@app.websocket("/media-stream")
async def media_stream(ws: WebSocket):
    """
    Bidirectional proxy: Twilio <-> OpenAI Realtime
    - Twilio sends audio/pcmu base64 in 'media.payload'
    - We push same payload to OpenAI as input_audio_buffer.append
    - We forward OpenAI response.output_audio.delta (audio/pcmu base64)
      straight back to Twilio as an outbound 'media' event
    """
    await ws.accept()
    print("[WS] Twilio stream connected")

    # Connect to OpenAI Realtime (WebSocket)
    oa_headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1",
    }
    async with websockets.connect(
        "wss://api.openai.com/v1/realtime?model=gpt-realtime",
        extra_headers=oa_headers,
    ) as oa:
        # Configure session: μ-law in/out + server VAD + persona
        session_update = {
            "type": "session.update",
            "session": {
                "type": "realtime",
                "model": "gpt-realtime",
                "instructions": SYSTEM_MESSAGE,
                "output_modalities": ["audio"],
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcmu"},
                        "turn_detection": {"type": "server_vad"},
                    },
                    "output": {
                        "format": {"type": "audio/pcmu"},
                        "voice": VOICE,
                    },
                },
            },
        }
        await oa.send(json.dumps(session_update))

        stream_sid = None
        greeted = False

        async def twilio_to_openai():
            nonlocal stream_sid, greeted
            try:
                async for message in ws.iter_text():
                    data = json.loads(message)
                    et = data.get("event")
                    if et == "start":
                        stream_sid = data["start"]["streamSid"]
                        print(f"[WS] start: streamSid={stream_sid}")
                        if not greeted:
                            greeted = True
                            await oa.send(json.dumps({
                                "type": "response.create",
                                "response": {
                                    "modalities": ["audio"],
                                    "instructions": "Hi love, I’m Auntie. I’m listening now."
                                }
                            }))
                    elif et == "media":
                        payload = data.get("media", {}).get("payload")
                        if payload:
                            # Forward μ-law audio to OA as-is
                            await oa.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": payload
                            }))
                        # With server_vad, no manual commit needed
                    elif et == "stop":
                        print("[WS] stop received")
                        break
            except WebSocketDisconnect:
                print("[WS] client disconnected (Twilio)")
            finally:
                try:
                    await oa.close()
                except:
                    pass

        async def openai_to_twilio():
            try:
                async for raw in oa:
                    try:
                        evt = json.loads(raw)
                    except Exception:
                        continue
                    t = evt.get("type")
                    if t in LOG_TYPES:
                        print("[OA]", t)

                    if t == "response.output_audio.delta" and evt.get("delta") and stream_sid:
                        # Send OA μ-law delta straight back to Twilio
                        await ws.send_json({
                            "event": "media",
                            "streamSid": stream_sid,
                            "media": {"payload": evt["delta"]}
                        })

                    if t == "response.completed" and stream_sid:
                        # Optional marker to help Twilio sequence audio
                        await ws.send_json({
                            "event": "mark",
                            "streamSid": stream_sid,
                            "mark": {"name": "auntie-turn-end"}
                        })
            except Exception as e:
                print("[OA] stream error:", repr(e))

        await asyncio.gather(twilio_to_openai(), openai_to_twilio())
        print("[WS] Twilio stream closed")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
