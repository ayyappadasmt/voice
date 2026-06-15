"""
Real-time voice agent bridge for the web client.

Browser  ──PCM16 16kHz──►  this bridge  ──►  Gemini 2.5 Flash Live
Browser  ◄─PCM16 24kHz──   this bridge  ◄──  Gemini 2.5 Flash Live

The model can call tools (find_leads, start_linkedin_campaign, ...) which we
execute server-side and feed back, so the platform acts on spoken commands
autonomously. Transcripts and tool activity are streamed to the browser too.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.services import tools

logger = logging.getLogger(__name__)

GEMINI_LIVE_URL = (
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha"
    ".GenerativeService.BidiGenerateContent"
)

INPUT_RATE = 16000  # what the browser sends

SYSTEM_PROMPT = """You are the voice interface for an autonomous agentic platform.
Users speak to you naturally — there are no dashboards or forms, only conversation.

You can take real action by calling the available tools:
- find_leads: source and qualify sales leads for a location/industry/role.
- start_linkedin_campaign: launch a LinkedIn outreach campaign to those leads.
- get_campaign_status: report how a campaign is performing.

Behaviour:
- When a request implies work (e.g. "find 100 leads in Kerala and start a LinkedIn
  campaign"), CALL the tools to actually do it, in the right order, without asking
  for unnecessary confirmation.
- After a tool runs, briefly confirm what you did using the tool's result.
- Keep spoken replies short, warm, and natural — this is a live conversation.
- Never read out long lists, URLs, or raw IDs. Summarise like a helpful colleague.
"""


def _setup_message(settings) -> dict:
    return {
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
            "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "tools": [{"function_declarations": tools.FUNCTION_DECLARATIONS}],
            "input_audio_transcription": {},
            "output_audio_transcription": {},
        }
    }


async def handle_web_voice(client_ws: WebSocket) -> None:
    await client_ws.accept()
    settings = get_settings()

    if not settings.gemini_api_key:
        await client_ws.send_text(json.dumps({"type": "error", "message": "Server missing GEMINI_API_KEY."}))
        await client_ws.close()
        return

    gemini_url = f"{GEMINI_LIVE_URL}?key={settings.gemini_api_key}"

    async def send_client(payload: dict) -> None:
        try:
            await client_ws.send_text(json.dumps(payload))
        except Exception:
            pass

    try:
        async with websockets.connect(gemini_url, ping_interval=20, max_size=None) as gemini_ws:
            await gemini_ws.send(json.dumps(_setup_message(settings)))

            async for raw in gemini_ws:
                if "setupComplete" in json.loads(raw):
                    break

            await send_client({"type": "status", "state": "ready"})

            # ── Browser -> Gemini ──────────────────────────────────────────
            async def client_to_gemini() -> None:
                async for raw_msg in client_ws.iter_text():
                    msg = json.loads(raw_msg)
                    mtype = msg.get("type")

                    if mtype == "audio":
                        await gemini_ws.send(
                            json.dumps(
                                {
                                    "realtimeInput": {
                                        "mediaChunks": [
                                            {
                                                "data": msg["data"],
                                                "mimeType": f"audio/pcm;rate={INPUT_RATE}",
                                            }
                                        ]
                                    }
                                }
                            )
                        )
                    elif mtype == "text" and msg.get("text"):
                        await gemini_ws.send(
                            json.dumps(
                                {
                                    "clientContent": {
                                        "turns": [
                                            {"role": "user", "parts": [{"text": msg["text"]}]}
                                        ],
                                        "turnComplete": True,
                                    }
                                }
                            )
                        )

            # ── Gemini -> Browser (+ tool execution) ───────────────────────
            async def gemini_to_client() -> None:
                async for raw in gemini_ws:
                    msg = json.loads(raw)

                    # Tool calls: execute and respond.
                    tool_call = msg.get("toolCall")
                    if tool_call:
                        responses = []
                        for fc in tool_call.get("functionCalls", []):
                            name = fc.get("name")
                            args = fc.get("args", {}) or {}
                            await send_client(
                                {"type": "tool_call", "name": name, "args": args}
                            )
                            result = await asyncio.to_thread(tools.execute_tool, name, args)
                            await send_client(
                                {"type": "tool_result", "name": name, "result": result}
                            )
                            responses.append(
                                {"id": fc.get("id"), "name": name, "response": {"result": result}}
                            )
                        await gemini_ws.send(
                            json.dumps({"toolResponse": {"functionResponses": responses}})
                        )
                        continue

                    server_content = msg.get("serverContent", {})

                    if server_content.get("interrupted"):
                        await send_client({"type": "interrupted"})

                    # Audio + text parts from the model.
                    for part in server_content.get("modelTurn", {}).get("parts", []):
                        inline = part.get("inlineData")
                        if inline and inline.get("data"):
                            await send_client({"type": "audio", "data": inline["data"]})

                    # Transcripts.
                    in_tx = server_content.get("inputTranscription", {}).get("text")
                    if in_tx:
                        await send_client({"type": "transcript", "role": "user", "text": in_tx})
                    out_tx = server_content.get("outputTranscription", {}).get("text")
                    if out_tx:
                        await send_client(
                            {"type": "transcript", "role": "assistant", "text": out_tx}
                        )

                    if server_content.get("turnComplete"):
                        await send_client({"type": "turn_complete"})

            await asyncio.gather(client_to_gemini(), gemini_to_client())

    except WebSocketDisconnect:
        logger.info("Web client disconnected")
    except Exception as exc:
        logger.error("Agent bridge error: %s", exc, exc_info=True)
        await send_client({"type": "error", "message": "Connection error."})
    finally:
        try:
            await client_ws.close()
        except Exception:
            pass
