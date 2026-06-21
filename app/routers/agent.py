from fastapi import APIRouter, WebSocket

from app.config import get_settings
from app.services.gemini_agent import handle_web_voice
from app.services.jobs import store

router = APIRouter(tags=["agent"])


@router.websocket("/ws/voice")
async def voice_socket(websocket: WebSocket):
    """Real-time spoken conversation channel for the web client."""
    await handle_web_voice(websocket)


@router.get("/agent/leads")
def list_leads():
    """Leads the agent has sourced (used by the UI activity feed)."""
    return store.list_leads()


@router.get("/agent/campaigns")
def list_campaigns():
    """Campaigns the agent has launched."""
    return store.list_campaigns()


@router.get("/agent/twilio-status")
def twilio_status():
    """Twilio config status for checking active twilio setup."""
    settings = get_settings()
    is_configured = bool(settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_phone_number)
    return {
        "is_configured": is_configured,
        "phone_number": settings.twilio_phone_number or "Not configured",
        "webhook_url": f"{settings.app_base_url.rstrip('/')}/voice-webhook",
        "validate_signature": settings.validate_twilio_signature
    }

