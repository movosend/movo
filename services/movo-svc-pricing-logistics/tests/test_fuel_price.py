"""MOVO-138: precio de combustible con cache en Redis.

La API de la Secretaría de Energía es externa, así que se reemplaza por un stub
(`StubCkanClient`) o por `httpx.MockTransport`. Redis es real, como pide el plan de
testing: los tests de cache se saltean en local si no hay Redis, pero en CI (`CI=true`)
fallan en vez de saltearse.
"""

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any, TypeVar
from unittest.mock import patch

import httpx
import pytest
from redis.asyncio import Redis, from_url

from app.config import settings
from app.services import fuel_price
from app.services.fuel_price import (
    BACKOFF_KEY,
    FETCH_LOCK_KEY,
    FETCH_LOCK_SECONDS,
    FRESH_KEY,
    LKG_KEY,
    LKG_TTL_SECONDS,
    RETRY_BACKOFF_SECONDS,
    EnergiaCkanClient,
    EnergiaFuelPriceProvider,
    FuelPriceUnavailableError,
    MockFuelPriceProvider,
    get_fuel_price_provider,
)

REDIS_TEST_URL = os.environ.get("REDIS_TEST_URL", "redis://localhost:6379/15")
T = TypeVar("T")


async def _redis_is_up() -> bool:
    client = from_url(REDIS_TEST_URL, decode_responses=True, socket_connect_timeout=1)
    try:
        return bool(await client.ping())
    except Exception:
        return False
    finally:
        await client.aclose()


@pytest.fixture
def real_redis() -> None:
    if asyncio.run(_redis_is_up()):
        return
    if os.environ.get("CI") == "true":
        pytest.fail(f"Redis no disponible en {REDIS_TEST_URL} (en CI es obligatorio)")
    pytest.skip(f"Redis no disponible en {REDIS_TEST_URL}")


def with_redis(fn: Callable[[Redis], Awaitable[T]]) -> T:
    """Corre `fn` con un cliente contra una base de Redis vacía, y la limpia al salir."""

    async def runner() -> T:
        client = from_url(REDIS_TEST_URL, decode_responses=True)
        try:
            await client.flushdb()
            return await fn(client)
        finally:
            await client.flushdb()
            await client.aclose()

    return asyncio.run(runner())


class StubCkanClient(EnergiaCkanClient):
    def __init__(self, result: tuple[float, int] | Exception):
        super().__init__()
        self.result = result
        self.calls = 0

    async def fetch_median(self) -> tuple[float, int]:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _cached(value: float, samples: int = 600) -> str:
    return json.dumps({"arsPerLiter": value, "samples": samples, "fetchedAt": 0})


# --- Provider con Redis real ---------------------------------------------------------


def test_cache_miss_fetches_and_stores_fresh_and_lkg(real_redis: None) -> None:
    async def run(redis: Redis) -> None:
        stub = StubCkanClient((2223.0, 619))
        price = await EnergiaFuelPriceProvider(client=stub, redis=redis).get_price()

        assert (price.ars_per_liter, price.source, price.samples) == (2223.0, "api", 619)
        assert stub.calls == 1
        assert json.loads(await redis.get(FRESH_KEY))["arsPerLiter"] == 2223.0
        assert json.loads(await redis.get(LKG_KEY))["arsPerLiter"] == 2223.0
        assert 0 < await redis.ttl(FRESH_KEY) <= settings.fuel_cache_ttl_seconds
        assert settings.fuel_cache_ttl_seconds < await redis.ttl(LKG_KEY) <= LKG_TTL_SECONDS

    with_redis(run)


def test_fresh_value_is_served_without_calling_the_api(real_redis: None) -> None:
    async def run(redis: Redis) -> None:
        await redis.set(FRESH_KEY, _cached(2100.0))
        stub = StubCkanClient((9999.0, 999))
        provider = EnergiaFuelPriceProvider(client=stub, redis=redis)

        for _ in range(5):
            price = await provider.get_price()
            assert (price.ars_per_liter, price.source) == (2100.0, "api")
        assert stub.calls == 0

    with_redis(run)


def test_api_failure_serves_lkg_and_starts_backoff(real_redis: None) -> None:
    async def run(redis: Redis) -> None:
        await redis.set(LKG_KEY, _cached(2150.0))
        stub = StubCkanClient(FuelPriceUnavailableError("caída"))
        provider = EnergiaFuelPriceProvider(client=stub, redis=redis)

        price = await provider.get_price()
        assert (price.ars_per_liter, price.source) == (2150.0, "lkg")
        assert 0 < await redis.ttl(BACKOFF_KEY) <= RETRY_BACKOFF_SECONDS

        # Durante el backoff no se vuelve a pagar el timeout de la API.
        await provider.get_price()
        assert stub.calls == 1

    with_redis(run)


def test_api_failure_without_lkg_uses_config(real_redis: None) -> None:
    async def run(redis: Redis) -> None:
        stub = StubCkanClient(TimeoutError())
        price = await EnergiaFuelPriceProvider(client=stub, redis=redis).get_price()
        assert (price.ars_per_liter, price.source) == (settings.fuel_price_fallback_ars_per_l, "config")

    with_redis(run)


def test_slow_api_is_cut_by_the_timeout(real_redis: None) -> None:
    class SlowClient(StubCkanClient):
        async def fetch_median(self) -> tuple[float, int]:
            await asyncio.sleep(5)
            return 2223.0, 619

    async def run(redis: Redis) -> None:
        with patch.object(fuel_price, "FETCH_TIMEOUT_SECONDS", 0.05):
            price = await EnergiaFuelPriceProvider(client=SlowClient((0, 0)), redis=redis).get_price()
        assert price.source == "config"

    with_redis(run)


def test_concurrent_quotes_call_the_api_once(real_redis: None) -> None:
    class SlowStub(StubCkanClient):
        async def fetch_median(self) -> tuple[float, int]:
            await asyncio.sleep(0.1)
            return await super().fetch_median()

    async def run(redis: Redis) -> None:
        await redis.set(LKG_KEY, _cached(2150.0))
        stub = SlowStub((2223.0, 619))
        provider = EnergiaFuelPriceProvider(client=stub, redis=redis)

        prices = await asyncio.gather(*(provider.get_price() for _ in range(5)))

        assert stub.calls == 1
        assert sorted(p.source for p in prices) == ["api", "lkg", "lkg", "lkg", "lkg"]
        assert 0 < await redis.ttl(FETCH_LOCK_KEY) <= FETCH_LOCK_SECONDS

    with_redis(run)


@pytest.mark.parametrize(
    ("value", "samples", "lkg"),
    [
        (2223.0, 49, None),  # pocas muestras
        (20.85, 600, None),  # outlier real relevado en Córdoba (spike §3.3)
        (12_000.0, 600, None),  # fuera de la cota superior
        (2223.0 * 1.3, 600, 2223.0),  # +30% contra el último valor bueno
        (2223.0 * 0.7, 600, 2223.0),  # -30% contra el último valor bueno
    ],
)
def test_insane_values_are_rejected(
    real_redis: None, value: float, samples: int, lkg: float | None
) -> None:
    async def run(redis: Redis) -> None:
        if lkg is not None:
            await redis.set(LKG_KEY, _cached(lkg))
        stub = StubCkanClient((value, samples))
        price = await EnergiaFuelPriceProvider(client=stub, redis=redis).get_price()

        assert price.source == ("lkg" if lkg is not None else "config")
        assert await redis.get(FRESH_KEY) is None
        assert await redis.exists(BACKOFF_KEY)

    with_redis(run)


def test_change_within_25_percent_is_accepted(real_redis: None) -> None:
    async def run(redis: Redis) -> None:
        await redis.set(LKG_KEY, _cached(2000.0))
        stub = StubCkanClient((2400.0, 600))  # +20%
        price = await EnergiaFuelPriceProvider(client=stub, redis=redis).get_price()
        assert (price.ars_per_liter, price.source) == (2400.0, "api")

    with_redis(run)


def test_corrupt_cache_entry_is_ignored(real_redis: None) -> None:
    async def run(redis: Redis) -> None:
        await redis.set(FRESH_KEY, "no-es-json")
        stub = StubCkanClient((2223.0, 619))
        price = await EnergiaFuelPriceProvider(client=stub, redis=redis).get_price()
        assert price.source == "api"
        assert stub.calls == 1

    with_redis(run)


def test_cache_write_failure_still_returns_the_fetched_price(real_redis: None) -> None:
    class ReadOnlyRedis(Redis):
        async def set(self, *args: Any, **kwargs: Any) -> Any:
            raise ConnectionError("READONLY You can't write against a read only replica.")

    async def run() -> None:
        redis = ReadOnlyRedis.from_url(REDIS_TEST_URL, decode_responses=True)
        try:
            await redis.delete(FRESH_KEY, LKG_KEY, BACKOFF_KEY, FETCH_LOCK_KEY)
            price = await EnergiaFuelPriceProvider(client=StubCkanClient((2223.0, 619)), redis=redis).get_price()
            assert (price.ars_per_liter, price.source) == (2223.0, "api")
            assert await redis.get(FRESH_KEY) is None
        finally:
            await redis.aclose()

    asyncio.run(run())


# --- Provider sin Redis ----------------------------------------------------------------


def test_without_redis_uses_config_and_never_calls_the_api() -> None:
    stub = StubCkanClient((2223.0, 619))
    with patch.object(fuel_price, "get_redis_client", return_value=None):
        price = asyncio.run(EnergiaFuelPriceProvider(client=stub).get_price())
    assert price.source == "config"
    assert stub.calls == 0


def test_unreachable_redis_degrades_to_config() -> None:
    async def run() -> Any:
        redis = from_url("redis://127.0.0.1:1/0", decode_responses=True, socket_connect_timeout=0.2)
        try:
            return await EnergiaFuelPriceProvider(client=StubCkanClient((2223.0, 619)), redis=redis).get_price()
        finally:
            await redis.aclose()

    assert asyncio.run(run()).source == "config"


def test_mock_provider_returns_config_value() -> None:
    price = asyncio.run(MockFuelPriceProvider().get_price())
    assert (price.ars_per_liter, price.source) == (settings.fuel_price_fallback_ars_per_l, "mock")


def test_factory_selects_provider_by_setting() -> None:
    with patch.object(settings, "fuel_price_provider", "energia"):
        assert isinstance(get_fuel_price_provider(), EnergiaFuelPriceProvider)
    with patch.object(settings, "fuel_price_provider", "mock"):
        assert isinstance(get_fuel_price_provider(), MockFuelPriceProvider)


# --- Cliente CKAN (API externa simulada con httpx.MockTransport) ----------------------


def _ckan(handler: Callable[[httpx.Request], httpx.Response]) -> EnergiaCkanClient:
    return EnergiaCkanClient(base_url="http://ckan.test", transport=httpx.MockTransport(handler))


def test_ckan_sql_path_returns_server_side_median() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"success": True, "result": {"records": [{"n": 619, "mediana": 2223.0}]}})

    assert asyncio.run(_ckan(handler).fetch_median()) == (2223.0, 619)
    sql = seen[0].url.params["sql"]
    assert seen[0].url.path == "/datastore_search_sql"
    assert "idproducto = 2" in sql and "INTERVAL '30 days'" in sql


def test_ckan_sql_without_fresh_samples_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"success": True, "result": {"records": [{"n": 0, "mediana": None}]}})

    with pytest.raises(FuelPriceUnavailableError):
        asyncio.run(_ckan(handler).fetch_median())


def test_ckan_falls_back_to_search_and_filters_stale_rows() -> None:
    now = datetime.now(timezone.utc)
    fresh = (now - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S")
    stale = (now - timedelta(days=400)).strftime("%Y-%m-%dT%H:%M:%S")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datastore_search_sql":
            return httpx.Response(403, json={"success": False, "error": {"message": "Not authorized"}})
        records = [
            {"precio": 2200.0, "fecha_vigencia": fresh},
            {"precio": 2250.0, "fecha_vigencia": fresh},
            {"precio": 2300.0, "fecha_vigencia": fresh},
            {"precio": 20.85, "fecha_vigencia": stale},  # declaración vieja: se descarta
            {"precio": None, "fecha_vigencia": fresh},
        ]
        return httpx.Response(200, json={"success": True, "result": {"records": records}})

    assert asyncio.run(_ckan(handler).fetch_median()) == (2250.0, 3)


@pytest.mark.parametrize(
    "search_response",
    [
        httpx.Response(200, json={"success": False, "error": "x"}),
        httpx.Response(200, json={"success": True, "result": {"records": []}}),
    ],
)
def test_ckan_search_without_usable_rows_raises(search_response: httpx.Response) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/datastore_search_sql":
            return httpx.Response(200, json={"success": False})
        return search_response

    with pytest.raises(FuelPriceUnavailableError):
        asyncio.run(_ckan(handler).fetch_median())


def test_ckan_server_error_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="Service Unavailable")

    with pytest.raises(FuelPriceUnavailableError):
        asyncio.run(_ckan(handler).fetch_median())
