import asyncio
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.config import settings
from app.services import redis_client
from main import app


def test_init_redis_without_url() -> None:
    async def run() -> None:
        with patch.object(settings, "redis_url", None):
            client = await redis_client.init_redis_client()
            assert client is None
            assert redis_client.get_redis_client() is None

    asyncio.run(run())


def test_init_redis_with_url() -> None:
    async def run() -> None:
        mock_redis_instance = AsyncMock()
        with (
            patch.object(settings, "redis_url", "redis://localhost:6379"),
            patch("app.services.redis_client.from_url", return_value=mock_redis_instance) as mock_from_url,
        ):
            client = await redis_client.init_redis_client()
            assert client is mock_redis_instance
            assert redis_client.get_redis_client() is mock_redis_instance
            mock_from_url.assert_called_once_with("redis://localhost:6379", decode_responses=True)

            await redis_client.close_redis_client()
            mock_redis_instance.aclose.assert_awaited_once()
            assert redis_client.get_redis_client() is None

    asyncio.run(run())


def test_init_redis_exception_handling() -> None:
    async def run() -> None:
        with (
            patch.object(settings, "redis_url", "redis://localhost:6379"),
            patch("app.services.redis_client.from_url", side_effect=ValueError("Invalid URL")),
        ):
            client = await redis_client.init_redis_client()
            assert client is None
            assert redis_client.get_redis_client() is None

    asyncio.run(run())


def test_ping_redis() -> None:
    async def run() -> None:
        # Caso 1: sin cliente
        with patch("app.services.redis_client.get_redis_client", return_value=None):
            assert await redis_client.ping_redis() is False

        # Caso 2: cliente responde True (PONG)
        mock_client = AsyncMock()
        mock_client.ping.return_value = True
        with patch("app.services.redis_client.get_redis_client", return_value=mock_client):
            assert await redis_client.ping_redis() is True

        # Caso 3: cliente falla al hacer ping
        mock_client.ping.side_effect = ConnectionError("Connection refused")
        with patch("app.services.redis_client.get_redis_client", return_value=mock_client):
            assert await redis_client.ping_redis() is False

    asyncio.run(run())


def test_close_redis_handles_exception() -> None:
    async def run() -> None:
        mock_client = AsyncMock()
        mock_client.aclose.side_effect = RuntimeError("Error closing")
        with patch.object(redis_client, "_redis_client", mock_client):
            await redis_client.close_redis_client()
            assert redis_client.get_redis_client() is None

    asyncio.run(run())


def test_health_endpoint_with_redis() -> None:
    client = TestClient(app)

    # Caso con redis_url configurada y conectado
    with (
        patch.object(settings, "redis_url", "redis://localhost:6379"),
        patch("main.ping_redis", AsyncMock(return_value=True)),
    ):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "redis": "connected"}

    # Caso con redis_url configurada pero desconectado
    with (
        patch.object(settings, "redis_url", "redis://localhost:6379"),
        patch("main.ping_redis", AsyncMock(return_value=False)),
    ):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "redis": "disconnected"}
