"""
Bridges a Twilio Media Stream (μ-law 8kHz audio over WebSocket)
with the Gemini 2.5 Flash Live API (native audio dialog).

Flow:
  Twilio WS  ──audio──►  this handler  ──audio──►  Gemini Live
  Twilio WS  ◄─audio──   this handler  ◄─audio──   Gemini Live
"""
import asyncio
import base64
import json
import logging
import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.services.rag_service import retrieve_relevant_context

logger = logging.getLogger(__name__)

GEMINI_LIVE_URL = (
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha"
    ".GenerativeService.BidiGenerateContent"
)


def _build_system_prompt(user_query_hint: str = "") -> str:
    context = retrieve_relevant_context(user_query_hint or "company information")
    return f"""You are a helpful voice assistant for this company. 
Answer caller questions using ONLY the company knowledge provided below.
If the answer is not in the knowledge base, say: "I don't have that information right now, 
but our team can help you. Please call back during business hours or visit our website."

Keep answers concise and friendly - this is a phone call.
Do not read out URLs or long lists. Summarise naturally.

--- COMPANY KNOWLEDGE ---
{context}
--- END OF KNOWLEDGE ---
"""


async def handle_twilio_gemini_bridge(twilio_ws: WebSocket):
    """Main WebSocket handler called by the /media-stream route."""
    await twilio_ws.accept()
    settings = get_settings()
    stream_sid = None

    gemini_url = f"{GEMINI_LIVE_URL}?key={settings.GEMINI_API_KEY}"

    try:
        async with websockets.connect(gemini_url, ping_interval=20) as gemini_ws:
            # ── 1. Send Gemini setup message ──────────────────────────────
            setup_msg = {
                "setup": {
                    "model": f"models/{settings.GEMINI_MODEL}",
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {"voice_name": "Aoede"}
                            }
                        },
                    },
                    "system_instruction": {
                        "parts": [{"text": _build_system_prompt()}]
                    },
                    "input_audio_transcription": {},   # enable transcription for logs
                }
            }
            await gemini_ws.send(json.dumps(setup_msg))

            # Wait for setupComplete
            async for raw in gemini_ws:
                msg = json.loads(raw)
                if "setupComplete" in msg:
                    logger.info("Gemini setup complete")
                    break

            # ── 2. Run both directions concurrently ───────────────────────
            async def twilio_to_gemini():
                nonlocal stream_sid
                async for raw_msg in twilio_ws.iter_text():
                    data = json.loads(raw_msg)
                    event = data.get("event")

                    if event == "start":
                        stream_sid = data["start"]["streamSid"]
                        logger.info(f"Stream started: {stream_sid}")

                    elif event == "media":
                        # Twilio sends μ-law 8kHz base64 audio
                        audio_b64 = data["media"]["payload"]
                        gemini_msg = {
                            "realtimeInput": {
                                "audio": {
                                    "data": audio_b64,
                                    "mimeType": "audio/pcm;rate=8000",  # Twilio mulaw → PCM
                                }
                            }
                        }
                        await gemini_ws.send(json.dumps(gemini_msg))

                    elif event == "stop":
                        logger.info("Twilio stream stopped")
                        break

            async def gemini_to_twilio():
                async for raw in gemini_ws:
                    msg = json.loads(raw)

                    # Audio response from Gemini
                    parts = (
                        msg.get("serverContent", {})
                           .get("modelTurn", {})
                           .get("parts", [])
                    )
                    for part in parts:
                        if "inlineData" in part:
                            audio_b64 = part["inlineData"]["data"]
                            if stream_sid:
                                twilio_payload = {
                                    "event": "media",
                                    "streamSid": stream_sid,
                                    "media": {"payload": audio_b64},
                                }
                                await twilio_ws.send_text(json.dumps(twilio_payload))

                    # Log transcriptions if present
                    transcript = (
                        msg.get("serverContent", {})
                           .get("inputTranscription", {})
                           .get("text")
                    )
                    if transcript:
                        logger.info(f"Caller said: {transcript}")

            await asyncio.gather(twilio_to_gemini(), gemini_to_twilio())

    except WebSocketDisconnect:
        logger.info("Twilio WebSocket disconnected")
    except Exception as e:
        logger.error(f"Bridge error: {e}", exc_info=True)
    finally:
        try:
            await twilio_ws.close()
        except Exception:
            pass
