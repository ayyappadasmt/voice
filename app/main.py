import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import health, twilio_webhook, knowledge, agent

logging.basicConfig(level=logging.INFO)

settings = get_settings()

app = FastAPI(title="Voice Agentic Platform", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    # Auth is via the X-API-Key header (not cookies), so credentials are not
    # needed; keeping this False avoids the insecure "*" + credentials combo.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
)

app.include_router(health.router)
app.include_router(agent.router)
app.include_router(twilio_webhook.router)
app.include_router(knowledge.router)

# Serve the static staff admin page at /admin
STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/admin", StaticFiles(directory=STATIC_DIR, html=True), name="admin")
