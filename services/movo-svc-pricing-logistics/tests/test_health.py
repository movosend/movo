from unittest.mock import patch

from fastapi.testclient import TestClient

from app.config import settings
from main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "ok"
    if "redis" in data:
        assert data["redis"] in ("connected", "disconnected")


def test_health_without_redis_url() -> None:
    with patch.object(settings, "redis_url", None):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
