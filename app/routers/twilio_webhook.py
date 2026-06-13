from fastapi import APIRouter, Request, Response, WebSocket
from fastapi.responses import PlainTextResponse

from app.services.twilio_service import build_stream_twiml
from app.services.gemini_live import handle_twilio_gemini_bridge

router = APIRouter()


@router.post("/voice-webhook")
async def voice_webhook(request: Request):
    """
    Twilio calls this HTTP endpoint when someone dials your number.
    We return TwiML instructing Twilio to open a Media Stream to /media-stream.
    """
    twiml = build_stream_twiml()
    return Response(content=twiml, media_type="application/xml")


@router.websocket("/media-stream")
async def media_stream(websocket: WebSocket):
    """
    Twilio streams audio here via WebSocket.
    We bridge it to Gemini Live.
    """
    await handle_twilio_gemini_bridge(websocket)