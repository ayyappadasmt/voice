from fastapi import APIRouter, WebSocket

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
