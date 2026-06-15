from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

AUTH = {"X-API-Key": "test-staff-key"}


def test_health():
    r = client.get("/health")
    assert r.status_code == 200


def test_knowledge_requires_auth():
    """Knowledge endpoints must reject requests without a valid staff key."""
    assert client.get("/knowledge/").status_code == 401
    assert client.get("/knowledge/", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.post("/knowledge/", json={"title": "x", "content": "y"}).status_code == 401


def test_verify_key():
    assert client.get("/knowledge/verify", headers=AUTH).json() == {"ok": True}


def test_knowledge_crud():
    # Create
    r = client.post(
        "/knowledge/",
        headers=AUTH,
        json={
            "title": "Business Hours",
            "content": "We are open Monday to Friday, 9am to 6pm.",
            "category": "general",
        },
    )
    assert r.status_code == 201
    chunk_id = r.json()["id"]

    # List
    r = client.get("/knowledge/", headers=AUTH)
    assert any(c["id"] == chunk_id for c in r.json())

    # Update (and updated_at should refresh)
    r = client.put(f"/knowledge/{chunk_id}", headers=AUTH, json={"content": "Open 24/7"})
    assert r.json()["content"] == "Open 24/7"

    # Delete
    r = client.delete(f"/knowledge/{chunk_id}", headers=AUTH)
    assert r.json()["deleted"] is True

    # Deleting again -> 404
    assert client.delete(f"/knowledge/{chunk_id}", headers=AUTH).status_code == 404


def test_knowledge_validation_rejects_empty():
    r = client.post("/knowledge/", headers=AUTH, json={"title": "", "content": ""})
    assert r.status_code == 422
