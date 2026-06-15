"""
Bridges a Twilio Media Stream (G.711 μ-law 8 kHz audio over WebSocket)
with the Gemini 2.5 Flash Live API (native audio dialog).

Flow:
  Twilio WS  ──μ-law──►  transcode ──PCM16──►  Gemini Live
  Twilio WS  ◄──μ-law──  transcode ◄──PCM16──  Gemini Live
"""
import asyncio
import base64
import json
import logging

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.services.audio import AudioConverter, GEMINI_INPUT_RATE
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


async def _await_authorized_start(twilio_ws: WebSocket, settings) -> str | None:
    """
    Read Twilio stream events until the ``start`` event, validating the
    optional auth token *before* any upstream (Gemini) connection is opened.
    Returns the streamSid, or ``None`` if the stream should be rejected/closed.
    """
    while True:
        try:
            raw = await twilio_ws.receive_text()
        except (WebSocketDisconnect, RuntimeError):
            return None

        data = json.loads(raw)
        event = data.get("event")

        if event == "start":
            start = data.get("start", {})
            stream_sid = start.get("streamSid")
            if settings.stream_auth_token:
                token = (start.get("customParameters") or {}).get("token")
                if token != settings.stream_auth_token:
                    logger.warning("Rejected media stream: invalid or missing token")
                    await twilio_ws.close(code=1008)
                    return None
            logger.info("Stream authorized: %s", stream_sid)
            return stream_sid

        if event == "stop":
            return None
        # ignore "connected" and any other pre-start events


async def handle_twilio_gemini_bridge(twilio_ws: WebSocket):
    """Main WebSocket handler called by the /media-stream route."""
    await twilio_ws.accept()
    settings = get_settings()
    converter = AudioConverter()

    stream_sid = await _await_authorized_start(twilio_ws, settings)
    if not stream_sid:
        try:
            await twilio_ws.close()
        except Exception:
            pass
        return

    gemini_url = f"{GEMINI_LIVE_URL}?key={settings.gemini_api_key}"

    try:
        async with websockets.connect(gemini_url, ping_interval=20) as gemini_ws:
            # ── 1. Send Gemini setup message ──────────────────────────────
            setup_msg = {
                "setup": {
                    "model": f"models/{settings.gemini_model}",
                    "generation_config": {
                        "response_modalities": ["AUDIO"],
                        "speech_config": {
                            "voice_config": {
                                "prebuilt_voice_config": {"voice_name": settings.gemini_voice}
                            }
                        },
                    },
                    "system_instruction": {"parts": [{"text": _build_system_prompt()}]},
                    "input_audio_transcription": {},
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
                async for raw_msg in twilio_ws.iter_text():
                    data = json.loads(raw_msg)
                    event = data.get("event")

                    if event == "media":
                        mulaw = base64.b64decode(data["media"]["payload"])
                        pcm16 = converter.twilio_to_gemini(mulaw)
                        gemini_msg = {
                            "realtimeInput": {
                                "mediaChunks": [
                                    {
                                        "data": base64.b64encode(pcm16).decode("ascii"),
                                        "mimeType": f"audio/pcm;rate={GEMINI_INPUT_RATE}",
                                    }
                                ]
                            }
                        }
                        await gemini_ws.send(json.dumps(gemini_msg))

                    elif event == "stop":
                        logger.info("Twilio stream stopped")
                        break

            async def gemini_to_twilio():
                async for raw in gemini_ws:
                    msg = json.loads(raw)
                    server_content = msg.get("serverContent", {})

                    # Barge-in: caller interrupted the assistant.
                    if server_content.get("interrupted") and stream_sid:
                        await twilio_ws.send_text(
                            json.dumps({"event": "clear", "streamSid": stream_sid})
                        )

                    # Audio response from Gemini (PCM16 24 kHz).
                    parts = server_content.get("modelTurn", {}).get("parts", [])
                    for part in parts:
                        inline = part.get("inlineData")
                        if inline and inline.get("data"):
                            pcm = base64.b64decode(inline["data"])
                            mulaw = converter.gemini_to_twilio(pcm)
                            if stream_sid:
                                await twilio_ws.send_text(
                                    json.dumps(
                                        {
                                            "event": "media",
                                            "streamSid": stream_sid,
                                            "media": {
                                                "payload": base64.b64encode(mulaw).decode("ascii")
                                            },
                                        }
                                    )
                                )

                    # Log caller transcriptions when available.
                    transcript = server_content.get("inputTranscription", {}).get("text")
                    if transcript:
                        logger.info("Caller said: %s", transcript)

            await asyncio.gather(twilio_to_gemini(), gemini_to_twilio())

    except WebSocketDisconnect:
        logger.info("Twilio WebSocket disconnected")
    except Exception as e:
        logger.error("Bridge error: %s", e, exc_info=True)
    finally:
        try:
            await twilio_ws.close()
        except Exception:
            pass
