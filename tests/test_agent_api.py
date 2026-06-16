from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_list_leads():
    response = client.get("/agent/leads")
    assert response.status_code == 200
    # Store starts empty
    assert isinstance(response.json(), list)

def test_list_campaigns():
    response = client.get("/agent/campaigns")
    assert response.status_code == 200
    # Store starts empty
    assert isinstance(response.json(), list)
