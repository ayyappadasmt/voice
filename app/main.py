import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, twilio_webhook, knowledge

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Voice AI Agent Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(twilio_webhook.router)
app.include_router(knowledge.router)