from fastapi.testclient import TestClient
from app.main import app
import pytest

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200

def test_knowledge_crud():
    # Create
    r = client.post("/knowledge/", json={
        "title": "Business Hours",
        "content": "We are open Monday to Friday, 9am to 6pm.",
        "category": "general"
    })
    assert r.status_code == 201
    chunk_id = r.json()["id"]

    # List
    r = client.get("/knowledge/")
    assert any(c["id"] == chunk_id for c in r.json())

    # Update
    r = client.put(f"/knowledge/{chunk_id}", json={"content": "Open 24/7"})
    assert r.json()["content"] == "Open 24/7"

    # Delete
    r = client.delete(f"/knowledge/{chunk_id}")
    assert r.json()["deleted"] is True