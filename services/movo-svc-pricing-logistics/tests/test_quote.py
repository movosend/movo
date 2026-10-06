"""MOVO-138: `POST /quote` con `demand_fuel_routes_v1`.

Los casos de la fórmula usan nafta a $2.000/l y una ruta fija de 100 km para que las
cuentas se verifiquen a mano:
    base      = 0,675 l × 2000                = 1.350
    por km    = (0,08 × 0,6 + 0,02) l × 2000   = 136   → 100 km = 13.600
    por kg    = 0,135 l × 2000                = 270   → 10 kg  = 2.700
    subtotal  = 17.650 (standard_package, sin recargo)
"""

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.models.optimize import Coordinates
from app.models.quote import DemandContext, PackageType, QuoteRequest
from app.services.fuel_price import FuelPrice, FuelPriceProvider
from app.services import pricing
from app.services.pricing import (
    DistanceSource,
    _round_to_10,
    compute_quote,
    demand_multiplier,
    road_distance_km,
)
from app.services.routes_provider import (
    DistanceMatrixResult,
    GoogleRoutesProvider,
    MockRoutesProvider,
    RoutesProvider,
    RoutesProviderError,
)
from main import app

client = TestClient(app)
T = TypeVar("T")


@pytest.fixture(autouse=True)
def _linear_distance(monkeypatch: pytest.MonkeyPatch) -> None:
    """Los casos de la fórmula asumen tarifa lineal por km; los tramos se prueban aparte."""
    monkeypatch.setattr(settings, "distance_tier1_km", 1e9)
    monkeypatch.setattr(settings, "distance_tier2_km", 1e9)


class FixedFuel(FuelPriceProvider):
    async def get_price(self) -> FuelPrice:
        return FuelPrice(ars_per_liter=2000.0, source="mock")


class FixedRoute(RoutesProvider):
    def __init__(self, km: float | Exception):
        self.km = km
        self.calls = 0

    def compute_matrix(self, waypoints: list[Coordinates]) -> DistanceMatrixResult:
        raise NotImplementedError

    def compute_route_km(self, origin: Coordinates, destination: Coordinates) -> float:
        self.calls += 1
        if isinstance(self.km, Exception):
            raise self.km
        return self.km


def _request(
    package_type: PackageType = PackageType.STANDARD_PACKAGE,
    demand: tuple[int, int] | None = None,
) -> QuoteRequest:
    return QuoteRequest(
        origin_lat=0,
        origin_lng=0,
        destination_lat=1,
        destination_lng=0,
        weight_kg=10,
        length_cm=20,
        width_cm=15,
        height_cm=10,
        package_type=package_type,
        demand_context=(
            DemandContext(published_shipments=demand[0], available_carriers=demand[1]) if demand else None
        ),
    )


def _quote(req: QuoteRequest, km: float = 100.0) -> tuple[float, bool]:
    res = asyncio.run(compute_quote(req, fuel_provider=FixedFuel(), routes=FixedRoute(km)))
    assert res.calculation_method.value == "demand_fuel_routes_v1"
    return res.suggested_price_ars, res.high_demand


# --- Fórmula ---------------------------------------------------------------------------


def test_formula_without_demand_context() -> None:
    assert _quote(_request()) == (17650.0, False)


def test_fragile_factor_applies_to_the_subtotal() -> None:
    assert _quote(_request(PackageType.FRAGILE_ITEM)) == (21180.0, False)  # 17.650 × 1,2


def test_price_scales_linearly_with_fuel_price() -> None:
    """Coeficientes en litros: si la nafta sube 20%, el precio sube 20% sin tocar config."""

    class PricierFuel(FuelPriceProvider):
        async def get_price(self) -> FuelPrice:
            return FuelPrice(ars_per_liter=2400.0, source="api")

    res = asyncio.run(compute_quote(_request(), fuel_provider=PricierFuel(), routes=FixedRoute(100.0)))
    assert res.suggested_price_ars == 21180.0  # 17.650 × 1,2


@pytest.mark.parametrize(
    ("demand", "expected_price", "high_demand"),
    [
        ((9, 2), 21180.0, True),  # ratio 5 → recargo 20%
        ((5, 2), 19420.0, True),  # ratio 3, justo en el umbral → 10% (19.415 redondea hacia arriba)
        ((2, 0), 17650.0, False),  # 3 envíos: debajo del mínimo de 4
        ((3, 5), 17650.0, False),  # ratio 0,8
        ((20, 1), 22950.0, True),  # ratio 21 → tope del 30% (22.945 redondea hacia arriba)
    ],
)
def test_demand_surcharge(demand: tuple[int, int], expected_price: float, high_demand: bool) -> None:
    assert _quote(_request(demand=demand)) == (expected_price, high_demand)


# Tabla del spike (§4.2): publicados, transportistas → multiplicador.
@pytest.mark.parametrize(
    ("published", "carriers", "multiplier"),
    [
        (2, 0, 1.0),
        (3, 0, 1.15),
        (3, 5, 1.0),
        (5, 2, 1.10),
        (8, 2, 1.175),
        (13, 2, 1.30),
        (20, 1, 1.30),
    ],
)
def test_demand_multiplier_matches_spike_table(published: int, carriers: int, multiplier: float) -> None:
    result = demand_multiplier(DemandContext(published_shipments=published, available_carriers=carriers))
    assert result.multiplier == pytest.approx(multiplier)
    # Badge si y solo si hay recargo.
    assert result.high_demand == (result.multiplier > 1.0)


def test_demand_multiplier_without_context_is_neutral() -> None:
    assert demand_multiplier(None).multiplier == 1.0


def test_demand_thresholds_come_from_config() -> None:
    ctx = DemandContext(published_shipments=5, available_carriers=2)  # ratio 3
    with patch.object(settings, "demand_ratio_threshold", 4.0):
        assert demand_multiplier(ctx).high_demand is False


@pytest.mark.parametrize(("value", "expected"), [(19405.0, 19410.0), (25.0, 30.0), (24.9, 20.0), (0.0, 0.0)])
def test_round_to_10_rounds_half_up(value: float, expected: float) -> None:
    assert _round_to_10(value) == expected


# --- Distancia por ruta y degradación --------------------------------------------------

ORIGIN = Coordinates(lat=0, lng=0)
DESTINATION = Coordinates(lat=1, lng=0)
STRAIGHT_KM = 111.195  # Haversine de (0,0) a (1,0)


def _distance(routes: RoutesProvider | None) -> tuple[float, DistanceSource]:
    return asyncio.run(road_distance_km(routes, ORIGIN, DESTINATION))


def test_routes_api_distance_is_used_as_is() -> None:
    assert _distance(FixedRoute(150.0)) == (150.0, "routes_api")


def test_mock_routes_provider_applies_road_factor() -> None:
    km, source = _distance(MockRoutesProvider())
    assert source == "haversine_mock"
    assert km == pytest.approx(STRAIGHT_KM * 1.3)


@pytest.mark.parametrize(
    "failure",
    [
        RoutesProviderError("Google Routes API devolvió un error (HTTP 500)."),
        RoutesProviderError("cuota agotada", status_code=503),
        TimeoutError(),
    ],
)
def test_routes_failure_degrades_to_haversine(failure: Exception) -> None:
    km, source = _distance(FixedRoute(failure))
    assert source == "haversine_fallback"
    assert km == pytest.approx(STRAIGHT_KM * 1.3)


def test_zero_route_distance_degrades_to_haversine() -> None:
    assert _distance(FixedRoute(0.0))[1] == "haversine_fallback"


def test_google_without_api_key_degrades_instead_of_failing() -> None:
    with patch.object(settings, "routes_provider", "google"), patch.object(settings, "google_maps_api_key", None):
        assert _distance(None)[1] == "haversine_fallback"


def test_quote_uses_short_google_timeout() -> None:
    with (
        patch.object(settings, "routes_provider", "google"),
        patch.object(settings, "google_maps_api_key", "test-key"),
        patch.object(GoogleRoutesProvider, "compute_route_km", autospec=True, return_value=150.0) as route,
    ):
        assert _distance(None) == (150.0, "routes_api")
    provider = route.call_args.args[0]
    assert provider.timeout == 1.5


class SlowRoute(FixedRoute):
    def __init__(self, km: float, delay: float):
        super().__init__(km)
        self.delay = delay

    def compute_route_km(self, origin: Coordinates, destination: Coordinates) -> float:
        time.sleep(self.delay)  # sync, como httpx.Client
        return super().compute_route_km(origin, destination)


class SlowFuel(FuelPriceProvider):
    def __init__(self, delay: float):
        self.delay = delay

    async def get_price(self) -> FuelPrice:
        await asyncio.sleep(self.delay)
        return FuelPrice(ars_per_liter=2000.0, source="api")


def _elapsed(coro_factory: Callable[[], Awaitable[T]]) -> tuple[T, float]:
    """Mide dentro del loop: `asyncio.run` espera a los threads del executor al cerrar."""

    async def run() -> tuple[T, float]:
        start = time.perf_counter()
        result = await coro_factory()
        return result, time.perf_counter() - start

    return asyncio.run(run())


def test_slow_routes_are_cut_by_the_quote_timeout() -> None:
    with patch.object(pricing, "QUOTE_ROUTES_TIMEOUT_SECONDS", 0.1):
        (km, source), elapsed = _elapsed(lambda: road_distance_km(SlowRoute(150.0, 0.5), ORIGIN, DESTINATION))
    assert source == "haversine_fallback"
    assert km == pytest.approx(STRAIGHT_KM * 1.3)
    assert elapsed < 0.4


def test_fuel_and_routes_run_in_parallel() -> None:
    # Con los topes reales (2s combustible, 1,5s rutas) en serie serían 3,5s, más que
    # los 3s de `pricing-client.ts`. Escalado a 0,3s + 0,3s para que el test sea rápido.
    with patch.object(pricing, "QUOTE_ROUTES_TIMEOUT_SECONDS", 1.0):
        res, elapsed = _elapsed(
            lambda: compute_quote(_request(), fuel_provider=SlowFuel(0.3), routes=SlowRoute(100.0, 0.3))
        )
    assert res.suggested_price_ars == 17650.0
    assert elapsed < 0.5


# --- GoogleRoutesProvider.compute_route_km (matriz 1x1) --------------------------------


def _google_response(status_code: int, body: object) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = body
    resp.text = json.dumps(body)
    return resp


def test_google_route_km_requests_a_single_element() -> None:
    body = [{"originIndex": 0, "destinationIndex": 0, "distanceMeters": 184250, "duration": "7200s"}]
    with patch("httpx.Client.post", return_value=_google_response(200, body)) as post:
        km = GoogleRoutesProvider(api_key="k").compute_route_km(ORIGIN, DESTINATION)

    assert km == 184.25
    payload = post.call_args.kwargs["json"]
    assert len(payload["origins"]) == 1 and len(payload["destinations"]) == 1


@pytest.mark.parametrize(
    "body",
    [
        [{"originIndex": 0, "destinationIndex": 0, "status": {"code": 5, "message": "NOT_FOUND"}}],
        [{"originIndex": 0, "destinationIndex": 0}],
        [],
    ],
)
def test_google_route_km_without_route_raises(body: object) -> None:
    with patch("httpx.Client.post", return_value=_google_response(200, body)):
        with pytest.raises(RoutesProviderError):
            GoogleRoutesProvider(api_key="k").compute_route_km(ORIGIN, DESTINATION)


def test_google_route_km_http_error_raises() -> None:
    with patch("httpx.Client.post", return_value=_google_response(429, {"error": "RESOURCE_EXHAUSTED"})):
        with pytest.raises(RoutesProviderError) as exc:
            GoogleRoutesProvider(api_key="k").compute_route_km(ORIGIN, DESTINATION)
    assert exc.value.status_code == 503


def test_google_route_km_network_error_raises() -> None:
    with patch("httpx.Client.post", side_effect=OSError("connection refused")):
        with pytest.raises(RoutesProviderError):
            GoogleRoutesProvider(api_key="k").compute_route_km(ORIGIN, DESTINATION)


def test_google_route_km_invalid_json_raises() -> None:
    resp = _google_response(200, None)
    resp.json.side_effect = ValueError("no JSON")
    with patch("httpx.Client.post", return_value=resp):
        with pytest.raises(RoutesProviderError):
            GoogleRoutesProvider(api_key="k").compute_route_km(ORIGIN, DESTINATION)


def test_default_route_km_uses_the_matrix() -> None:
    km = MockRoutesProvider().compute_route_km(ORIGIN, DESTINATION)
    assert km == STRAIGHT_KM


# --- Endpoint --------------------------------------------------------------------------

BODY = {
    "originLat": 0,
    "originLng": 0,
    "destinationLat": 1,
    "destinationLng": 0,
    "weightKg": 10,
    "lengthCm": 20,
    "widthCm": 15,
    "heightCm": 10,
    "packageType": "standard_package",
    "urgent": False,
}


def test_endpoint_with_default_mocks(caplog: pytest.LogCaptureFixture) -> None:
    # Defaults de dev/CI: FUEL_PRICE_PROVIDER=mock (2.222,5 $/l), ROUTES_PROVIDER=mock.
    # 111,195 km × 1,3 = 144,5535 km
    # 1.500,19 + 144,5535 × 151,13 + 10 × 300,04 = 26.346,93 → 26.350
    with caplog.at_level(logging.INFO, logger="app.services.pricing"):
        response = client.post("/quote", json=BODY)

    assert response.status_code == 200
    assert response.json() == {
        "suggestedPriceArs": 26350.0,
        "highDemand": False,
        "calculationMethod": "demand_fuel_routes_v1",
    }

    [record] = [r for r in caplog.records if r.getMessage().startswith("pricing_quote_computed")]
    logged = json.loads(record.getMessage().removeprefix("pricing_quote_computed "))
    assert logged["distanceSource"] == "haversine_mock"
    assert logged["fuelSource"] == "mock"
    assert logged["demandContext"] is None


def test_endpoint_with_high_demand() -> None:
    body = {**BODY, "demandContext": {"publishedShipments": 9, "availableCarriers": 2}}
    response = client.post("/quote", json=body)

    assert response.status_code == 200
    assert response.json()["highDemand"] is True
    assert response.json()["suggestedPriceArs"] == 31620.0  # 26.346,93 × 1,2 = 31.616,32


def test_endpoint_rejects_negative_demand_context() -> None:
    body = {**BODY, "demandContext": {"publishedShipments": -1, "availableCarriers": 2}}
    assert client.post("/quote", json=body).status_code == 422


def test_endpoint_missing_field_returns_422() -> None:
    body = {k: v for k, v in BODY.items() if k != "weightKg"}
    assert client.post("/quote", json=body).status_code == 422


# --- Desglose opt-in (juego de precios) --------------------------------------------------


def test_breakdown_is_omitted_by_default() -> None:
    res = asyncio.run(compute_quote(_request(), fuel_provider=FixedFuel(), routes=FixedRoute(100.0)))
    assert res.breakdown is None


def test_breakdown_matches_the_formula_when_requested() -> None:
    req = _request(PackageType.FRAGILE_ITEM).model_copy(update={"include_breakdown": True})
    res = asyncio.run(compute_quote(req, fuel_provider=FixedFuel(), routes=FixedRoute(100.0)))

    assert res.suggested_price_ars == 21180.0  # 17.650 × 1,2
    assert res.breakdown is not None
    b = res.breakdown
    assert (b.base, b.distance, b.weight) == (1350.0, 13600.0, 2700.0)
    assert (b.distance_km, b.distance_source) == (100.0, "routes_api")
    assert (b.fuel_ars_per_liter, b.fuel_source) == (2000.0, "mock")
    assert (b.per_km_ars, b.package_factor, b.demand_multiplier) == (136.0, 1.2, 1.0)


def test_endpoint_never_sends_breakdown_without_the_flag() -> None:
    assert "breakdown" not in client.post("/quote", json=BODY).json()


def test_endpoint_sends_breakdown_with_the_flag() -> None:
    response = client.post("/quote", json={**BODY, "includeBreakdown": True})

    assert response.status_code == 200
    body = response.json()
    assert body["suggestedPriceArs"] == 26350.0  # el flag no cambia el precio
    assert body["breakdown"]["distanceSource"] == "haversine_mock"
    assert body["breakdown"]["fuelSource"] == "mock"
    assert set(body["breakdown"]) == {
        "distanceKm", "distanceSource", "fuelArsPerLiter", "fuelSource", "perKmArs",
        "base", "distance", "weight", "packageFactor", "demandRatio", "demandMultiplier",
    }


# --- Tramos decrecientes de distancia (hotfix larga distancia) -------------------------


@pytest.mark.parametrize(
    ("km", "expected"),
    [(0, 0.0), (30, 30.0), (50, 50.0), (150, 50 + 100 * 0.3), (300, 50 + 250 * 0.3), (2300, 125 + 2000 * 0.025)],
)
def test_effective_distance_tiers(monkeypatch: pytest.MonkeyPatch, km: float, expected: float) -> None:
    monkeypatch.setattr(settings, "distance_tier1_km", 50.0)
    monkeypatch.setattr(settings, "distance_tier2_km", 300.0)
    assert pricing.effective_distance_km(km) == pytest.approx(expected)


def test_long_distance_document_stays_under_30k(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "distance_tier1_km", 50.0)
    monkeypatch.setattr(settings, "distance_tier2_km", 300.0)
    price, _ = _quote(_request(), km=2300.0)  # Chubut → Tucumán
    assert price < 30000
