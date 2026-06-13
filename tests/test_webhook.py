"""
Tests for the Twilio webhook route.
We don't test the actual WebSocket bridge (needs live Gemini + Twilio),
but we test that the webhook returns valid TwiML.
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
from app.main import app

client = TestClient(app)


def test_voice_webhook_returns_xml():
    """POST /voice-webhook should return a 200 with XML content type."""
    response = client.post("/voice-webhook")
    assert response.status_code == 200
    assert "application/xml" in response.headers["content-type"]


def test_voice_webhook_contains_twiml_tags():
    """Response must contain valid TwiML root and Connect/Stream tags."""
    response = client.post("/voice-webhook")
    body = response.text

    assert "<Response>" in body
    assert "</Response>" in body
    assert "<Connect>" in body
    assert "<Stream" in body
    assert "url=" in body


def test_voice_webhook_stream_url_is_wss():
    """The Stream URL must use wss:// (WebSocket Secure) not http://"""
    response = client.post("/voice-webhook")
    body = response.text
    assert "wss://" in body


def test_voice_webhook_stream_url_has_correct_path():
    """Stream URL must point to /media-stream endpoint."""
    response = client.post("/voice-webhook")
    body = response.text
    assert "/media-stream" in body


def test_voice_webhook_has_greeting():
    """TwiML should contain a <Say> greeting before connecting."""
    response = client.post("/voice-webhook")
    body = response.text
    assert "<Say" in body
    assert "</Say>" in body


def test_voice_webhook_accepts_post_only():
    """GET should return 405 Method Not Allowed."""
    response = client.get("/voice-webhook")
    assert response.status_code == 405


def test_voice_webhook_with_twilio_params():
    """
    Twilio sends form params with every webhook call.
    Our endpoint should handle them gracefully even if we don't use them.
    """
    response = client.post("/voice-webhook", data={
        "AccountSid": "ACtest123",
        "CallSid": "CAtest456",
        "From": "+919999999999",
        "To": "+11234567890",
        "CallStatus": "ringing",
        "Direction": "inbound",
    })
    assert response.status_code == 200
    assert "<Response>" in response.text