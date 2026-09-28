"""Precio de referencia de la nafta para `demand_fuel_routes_v1` (MOVO-138, ADR-025).

Fuente: API CKAN de la Secretaría de Energía, dataset "Precios en surtidor"
(Res. 314/2016). Detalle de la elección y los hallazgos empíricos en
`docs/pricing/pricing-spike-report.md` §3.

A diferencia de la política No-Fallback del ruteo (MOVO-205), acá degradar es
deliberado: el precio de ayer aproxima muy bien al de hoy, y fallar la cotización deja
el envío en "precio a estimar". Orden de degradación: valor fresco en Redis → API →
último valor bueno (`:lkg`) → fallback de config.
"""

from __future__ import annotations

import asyncio
import json
import logging
import statistics
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx
from redis.asyncio import Redis

from app.config import settings
from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)

# Solo HTTP: el endpoint HTTPS responde 301 a HTTP (relevado el 24/09/2026). Sin TLS la
# respuesta podría venir alterada, por eso los controles de cordura de abajo.
CKAN_BASE_URL = "http://datos.energia.gob.ar/api/3/action"
# Recurso "Precios vigentes en surtidor - Resolución 314/2016", actualizado a diario.
RESOURCE_ID = "80ac25de-a44a-4445-9215-090cf55cfda5"
PRODUCT_NAFTA_SUPER = 2
HORARIO_DIURNO = 2

# Cada estación figura con su ÚLTIMA declaración, aunque tenga años: sin este filtro la
# mediana subestima ~40% (spike §3.3).
FRESHNESS_DAYS = 30

# Controles de cordura: un valor que no los pasa se descarta y se usa el anterior.
MIN_SAMPLES = 50
SANE_MIN_ARS_PER_L = 500.0
SANE_MAX_ARS_PER_L = 10_000.0
MAX_CHANGE_VS_LKG = 0.25

# Presupuesto total de la consulta, por debajo de los 3s de `pricing-client.ts`
# (`movo-svc-shipments`), así una API lenta nunca le cuesta el precio al envío.
FETCH_TIMEOUT_SECONDS = 2.0
LKG_TTL_SECONDS = 7 * 24 * 3600
# Tras una falla o un valor rechazado no se reintenta durante este lapso: sin esto, con
# la API caída cada cotización pagaría el timeout completo.
RETRY_BACKOFF_SECONDS = 600
# Cuando vence el valor fresco, solo la cotización que toma este lock consulta la API;
# las concurrentes sirven `:lkg`/config en vez de disparar todas la misma query contra
# un servicio sin SLA. Mayor que `FETCH_TIMEOUT_SECONDS` para cubrir la consulta entera.
FETCH_LOCK_SECONDS = 10

FRESH_KEY = f"fuel_price:{PRODUCT_NAFTA_SUPER}"
LKG_KEY = f"{FRESH_KEY}:lkg"
BACKOFF_KEY = f"{FRESH_KEY}:backoff"
FETCH_LOCK_KEY = f"{FRESH_KEY}:lock"

FuelPriceSource = Literal["api", "lkg", "config", "mock"]


class FuelPriceUnavailableError(Exception):
    """La API no devolvió un valor utilizable."""


@dataclass(frozen=True)
class FuelPrice:
    ars_per_liter: float
    source: FuelPriceSource
    samples: int = 0


class EnergiaCkanClient:
    """Consulta la mediana nacional de nafta súper con declaraciones de los últimos
    `FRESHNESS_DAYS` días."""

    def __init__(self, base_url: str = CKAN_BASE_URL, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url
        self.transport = transport

    async def fetch_median(self) -> tuple[float, int]:
        async with httpx.AsyncClient(
            base_url=self.base_url, transport=self.transport, timeout=FETCH_TIMEOUT_SECONDS
        ) as client:
            try:
                return await self._fetch_via_sql(client)
            except _SqlEndpointDisabledError:
                # Algunos CKAN deshabilitan `datastore_search_sql`: la vía alternativa trae
                # las filas del producto (~4.200, ~360 KB) y agrega localmente.
                return await self._fetch_via_search(client)

    async def _fetch_via_sql(self, client: httpx.AsyncClient) -> tuple[float, int]:
        sql = (
            "SELECT COUNT(*) AS n, "
            "percentile_cont(0.5) WITHIN GROUP (ORDER BY precio) AS mediana "
            f'FROM "{RESOURCE_ID}" '
            f"WHERE idproducto = {PRODUCT_NAFTA_SUPER} AND idtipohorario = {HORARIO_DIURNO} "
            f"AND fecha_vigencia >= NOW() - INTERVAL '{FRESHNESS_DAYS} days'"
        )
        data = await _get_json(client, "/datastore_search_sql", {"sql": sql})
        if not data.get("success"):
            raise _SqlEndpointDisabledError(str(data.get("error")))
        row = data["result"]["records"][0]
        if row.get("mediana") is None:
            raise FuelPriceUnavailableError("sin muestras frescas")
        return float(row["mediana"]), int(row["n"])

    async def _fetch_via_search(self, client: httpx.AsyncClient) -> tuple[float, int]:
        params = {
            "resource_id": RESOURCE_ID,
            "filters": json.dumps({"idproducto": PRODUCT_NAFTA_SUPER, "idtipohorario": HORARIO_DIURNO}),
            "fields": "precio,fecha_vigencia",
            "limit": "10000",
        }
        data = await _get_json(client, "/datastore_search", params)
        if not data.get("success"):
            raise FuelPriceUnavailableError(f"datastore_search sin éxito: {data.get('error')}")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=FRESHNESS_DAYS)).strftime("%Y-%m-%dT%H:%M:%S")
        prices = [
            float(r["precio"])
            for r in data["result"]["records"]
            if r.get("precio") is not None and str(r.get("fecha_vigencia") or "") >= cutoff
        ]
        if not prices:
            raise FuelPriceUnavailableError("sin muestras frescas")
        return statistics.median(prices), len(prices)


class _SqlEndpointDisabledError(Exception):
    pass


async def _get_json(client: httpx.AsyncClient, path: str, params: dict[str, str]) -> dict[str, Any]:
    response = await client.get(path, params=params)
    # CKAN responde 403/409 con `success: false` en el body cuando rechaza el request.
    if response.status_code >= 500:
        raise FuelPriceUnavailableError(f"HTTP {response.status_code}")
    body: dict[str, Any] = response.json()
    return body


class FuelPriceProvider(ABC):
    @abstractmethod
    async def get_price(self) -> FuelPrice:
        """Nunca lanza: siempre devuelve un precio utilizable."""


class MockFuelPriceProvider(FuelPriceProvider):
    """Default de dev/test/CI: valor fijo de config, sin red ni Redis (molde de ADR-012)."""

    async def get_price(self) -> FuelPrice:
        return FuelPrice(ars_per_liter=settings.fuel_price_fallback_ars_per_l, source="mock")


class EnergiaFuelPriceProvider(FuelPriceProvider):
    """Consulta lazy: la API se llama en la primera cotización después de que vence el
    valor fresco, no con un job periódico (el servicio no tiene scheduler y el dataset
    se actualiza una vez por día)."""

    def __init__(self, client: EnergiaCkanClient | None = None, redis: Redis | None = None):
        self.client = client or EnergiaCkanClient()
        self._redis = redis

    @property
    def redis(self) -> Redis | None:
        return self._redis if self._redis is not None else get_redis_client()

    async def get_price(self) -> FuelPrice:
        redis = self.redis
        if redis is None:
            # Sin Redis no hay cache: consultar la API en cada cotización no es opción.
            return self._config_price()

        try:
            fresh = await _read_cached(redis, FRESH_KEY)
            if fresh is not None:
                return FuelPrice(fresh["arsPerLiter"], "api", fresh["samples"])
            lkg = await _read_cached(redis, LKG_KEY)
            in_backoff = bool(await redis.exists(BACKOFF_KEY))
        except Exception as exc:  # noqa: BLE001 — Redis caído degrada a config
            logger.warning("fuel_price_redis_failed error=%s", exc)
            return self._config_price()

        if not in_backoff and await _try_fetch_lock(redis):
            fetched = await self._fetch_sane(lkg)
            if fetched is not None:
                await self._store(redis, fetched)
                return fetched
            await _safe_set(redis, BACKOFF_KEY, "1", RETRY_BACKOFF_SECONDS)

        if lkg is not None:
            return FuelPrice(lkg["arsPerLiter"], "lkg", lkg["samples"])
        return self._config_price()

    async def _fetch_sane(self, lkg: dict[str, Any] | None) -> FuelPrice | None:
        try:
            value, samples = await asyncio.wait_for(self.client.fetch_median(), FETCH_TIMEOUT_SECONDS)
        except Exception as exc:  # noqa: BLE001 — cualquier falla de la API degrada igual
            logger.warning("fuel_price_fetch_failed error=%r", exc)
            return None

        if not _is_sane(value, samples, lkg["arsPerLiter"] if lkg else None):
            logger.warning("fuel_price_rejected value=%s samples=%s", value, samples)
            return None
        return FuelPrice(round(value, 2), "api", samples)

    async def _store(self, redis: Redis, price: FuelPrice) -> None:
        payload = json.dumps(
            {"arsPerLiter": price.ars_per_liter, "samples": price.samples, "fetchedAt": time.time()}
        )
        await _safe_set(redis, FRESH_KEY, payload, settings.fuel_cache_ttl_seconds)
        await _safe_set(redis, LKG_KEY, payload, LKG_TTL_SECONDS)

    @staticmethod
    def _config_price() -> FuelPrice:
        return FuelPrice(ars_per_liter=settings.fuel_price_fallback_ars_per_l, source="config")


def _is_sane(value: float, samples: int, lkg_value: float | None) -> bool:
    if samples < MIN_SAMPLES or not SANE_MIN_ARS_PER_L <= value <= SANE_MAX_ARS_PER_L:
        return False
    # No distingue un dato alterado de un aumento brusco real: si el aumento es real,
    # entra cuando vence el `:lkg` (7 días). Riesgo aceptado en el spike (§8).
    if lkg_value is not None and abs(value / lkg_value - 1) > MAX_CHANGE_VS_LKG:
        return False
    return True


async def _read_cached(redis: Redis, key: str) -> dict[str, Any] | None:
    raw = await redis.get(key)
    if raw is None:
        return None
    try:
        data: dict[str, Any] = json.loads(raw)
        float(data["arsPerLiter"])
        int(data["samples"])
    except (ValueError, KeyError, TypeError):
        logger.warning("fuel_price_cache_corrupt key=%s", key)
        return None
    return data


async def _try_fetch_lock(redis: Redis) -> bool:
    try:
        return bool(await redis.set(FETCH_LOCK_KEY, "1", nx=True, ex=FETCH_LOCK_SECONDS))
    except Exception as exc:  # noqa: BLE001 — sin lock se consulta igual, como antes del lock
        logger.warning("fuel_price_lock_failed error=%s", exc)
        return True


async def _safe_set(redis: Redis, key: str, value: str, ttl_seconds: int) -> None:
    try:
        await redis.set(key, value, ex=ttl_seconds)
    except Exception as exc:  # noqa: BLE001 — perder el cache no invalida el precio ya obtenido
        logger.warning("fuel_price_cache_write_failed key=%s error=%s", key, exc)


def get_fuel_price_provider() -> FuelPriceProvider:
    if settings.fuel_price_provider == "energia":
        return EnergiaFuelPriceProvider()
    return MockFuelPriceProvider()
