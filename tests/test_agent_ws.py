import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_voice_ws_accepts_connection():
    # We test that the WebSocket accepts the connection.
    # We expect the server to close it immediately with code 4003 
    # if no GEMINI_API_KEY is provided in the environment or if we don't send the proper initial config.
    # The TestClient's context manager initiates the connection.
    with client.websocket_connect("/ws/voice") as websocket:
        # Just connecting and then cleanly exiting the context block
        # is a success for accepting the connection.
        pass
