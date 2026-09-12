"""Cliente Redis asíncrono para movo-svc-pricing-logistics (MOVO-217).

Gestiona la conexión y el ciclo de vida del cliente Redis (redis.asyncio)
utilizado para el cacheo de soluciones de ruteo y evaluación de candidatos (MOVO-218).
"""

from __future__ import annotations

import logging
from typing import Optional

from redis.asyncio import Redis, from_url

from app.config import settings

logger = logging.getLogger(__name__)

_redis_client: Optional[Redis] = None


async def init_redis_client() -> Optional[Redis]:
    """Inicializa la conexión a Redis si REDIS_URL está configurada."""
    global _redis_client
    if not settings.redis_url:
        logger.info("REDIS_URL no está configurada. Operando sin conexión a Redis.")
        _redis_client = None
        return None

    try:
        _redis_client = from_url(
            settings.redis_url,
            decode_responses=True,
        )
        logger.info("Cliente Redis inicializado correctamente.")
        return _redis_client
    except Exception as e:
        logger.warning(f"Error al inicializar cliente Redis: {e}")
        _redis_client = None
        return None


async def close_redis_client() -> None:
    """Cierra la conexión con Redis si existe."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception as e:
            logger.warning(f"Error al cerrar conexión con Redis: {e}")
        finally:
            _redis_client = None


def get_redis_client() -> Optional[Redis]:
    """Retorna la instancia global del cliente Redis."""
    return _redis_client


async def ping_redis() -> bool:
    """Comprueba la conectividad con Redis mediante PING.

    Retorna True si responde PONG, False si no está conectado o falla.
    """
    client = get_redis_client()
    if client is None:
        return False
    try:
        return bool(await client.ping())
    except Exception as e:
        logger.warning(f"Fallo de ping a Redis: {e}")
        return False
