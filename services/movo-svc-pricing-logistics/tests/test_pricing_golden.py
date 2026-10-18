"""MOVO-276: golden tests de `package_tapered_v2` sobre la grilla de referencia y forma
de la curva de precio.

La grilla (`tests/pricing_grid.py`) y la banda contra el Correo están documentadas en
`docs/pricing/grilla-referencia.md`. Si se recalibra un coeficiente a propósito, estos
valores cambian: actualizar la tabla del documento con `python -m tests.pricing_grid`.
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.models.quote import PackageType, QuoteRequest
from app.services.pricing import (
    PackageLimitsExceededError,
    _round_to_10,
    compute_quote,
    package_limit_violations,
    price_components,
)
from main import app
from tests.pricing_grid import (
    BAND_MAX_RATIO,
    BAND_MIN_RATIO,
    GRID_FUEL_ARS_PER_L,
    PACKAGES,
    ROUTES,
    GridFuel,
    correo_reference_ars,
    quote_grid,
)

client = TestClient(app)

PACKAGE_KEYS = ("carta", "zapatos", "caja_5kg", "tv_liviano", "pesado_20kg", "fragil_chico", "cubo_max")
GOLDEN: dict[str, tuple[float, ...]] = {
    "urbano": (1460, 3280, 6080, 10030, 9930, 4650, 48430),
    "carlos_paz": (4920, 6740, 9530, 13490, 13380, 8800, 51890),
    "rio_cuarto": (11260, 13080, 15880, 19830, 19730, 16410, 58230),
    "rosario": (13240, 15060, 17850, 21800, 21700, 18780, 60210),
    "san_juan": (13350, 15170, 17970, 21920, 21820, 18920, 60320),
    "caba": (14040, 15860, 18650, 22610, 22500, 19740, 61010),
    "posadas": (14850, 16660, 19460, 23410, 23310, 20710, 61820),
    "puerto_iguazu": (15490, 17310, 20110, 24060, 23960, 21490, 62460),
}


@pytest.fixture(scope="module")
def grid() -> dict[tuple[str, str], float]:
    return {key: res.suggested_price_ars for key, res in asyncio.run(quote_grid()).items()}


def test_golden_grid_covers_every_cell() -> None:
    assert set(GOLDEN) == {r.key for r in ROUTES}
    assert PACKAGE_KEYS == tuple(p.key for p in PACKAGES)


@pytest.mark.parametrize("route", list(GOLDEN))
def test_golden_grid(grid: dict[tuple[str, str], float], route: str) -> None:
    assert tuple(grid[(route, pkg)] for pkg in PACKAGE_KEYS) == GOLDEN[route]


def test_grid_cells_with_a_reference_fall_in_the_band(grid: dict[tuple[str, str], float]) -> None:
    """AC1: los paquetes estándar de hasta 10 kg facturables en rutas de 200 km o más
    quedan entre 0,6x y 1,0x del Correo clásico a domicilio."""
    checked = 0
    for route in ROUTES:
        for pkg in PACKAGES:
            ref = correo_reference_ars(route, pkg)
            if ref is None:
                continue
            ratio = grid[(route.key, pkg.key)] / ref
            assert BAND_MIN_RATIO <= ratio <= BAND_MAX_RATIO, (route.key, pkg.key, round(ratio, 3))
            checked += 1
    assert checked == 12  # 6 rutas interurbanas x 2 paquetes con tramo relevado


def test_grid_uses_the_new_method() -> None:
    res = asyncio.run(quote_grid())
    assert {r.calculation_method.value for r in res.values()} == {"package_tapered_v2"}


# --- Forma de la curva (AC2) --------------------------------------------------------------


def _req(
    package_type: PackageType = PackageType.STANDARD_PACKAGE,
    weight_kg: float = 2.0,
    sides: tuple[float, float, float] = (30, 20, 10),
) -> QuoteRequest:
    return QuoteRequest(
        origin_lat=0,
        origin_lng=0,
        destination_lat=1,
        destination_lng=0,
        weight_kg=weight_kg,
        length_cm=sides[0],
        width_cm=sides[1],
        height_cm=sides[2],
        package_type=package_type,
    )


def _subtotal(req: QuoteRequest, km: float) -> float:
    return price_components(req, km, GRID_FUEL_ARS_PER_L).subtotal


KMS = [float(km) for km in range(0, 3001, 5)]
SAMPLE_REQUESTS = [
    _req(PackageType.LETTER_DOCUMENT, 0.2, (30, 22, 1)),
    _req(),
    _req(PackageType.FRAGILE_ITEM, 5, (40, 30, 30)),
    _req(weight_kg=8, sides=(105, 65, 15)),
]


@pytest.mark.parametrize("req", SAMPLE_REQUESTS)
def test_price_never_decreases_with_distance(req: QuoteRequest) -> None:
    prices = [_subtotal(req, km) for km in KMS]
    assert all(b >= a for a, b in zip(prices, prices[1:]))
    rounded = [_round_to_10(p) for p in prices]
    assert all(b >= a for a, b in zip(rounded, rounded[1:]))


@pytest.mark.parametrize("req", SAMPLE_REQUESTS)
def test_price_is_concave_in_distance(req: QuoteRequest) -> None:
    """El costo de cada km adicional nunca crece. Se mide antes del redondeo a $10, que
    rompe la concavidad en escalones chicos sin cambiar la forma de la curva."""
    prices = [_subtotal(req, km) for km in KMS]
    slopes = [b - a for a, b in zip(prices, prices[1:])]
    assert all(b <= a + 1e-6 for a, b in zip(slopes, slopes[1:]))


@pytest.mark.parametrize("package_type", list(PackageType))
def test_price_never_decreases_with_billable_weight(package_type: PackageType) -> None:
    # 0,1 a 30 kg reales en una caja de 5 cm (0,025 kg volumétricos): factura el real.
    weights = [w / 10 for w in range(1, 301)]
    prices = [_subtotal(_req(package_type, w, (5, 5, 5)), 500) for w in weights]
    assert all(b > a for a, b in zip(prices, prices[1:]))


def test_price_never_decreases_with_volume() -> None:
    sides = [float(s) for s in range(10, 101)]  # cubos de 10 a 100 cm
    prices = [_subtotal(_req(weight_kg=1, sides=(s, s, s)), 500) for s in sides]
    assert all(b >= a for a, b in zip(prices, prices[1:]))


# --- Categoría y peso volumétrico (AC3) -----------------------------------------------------


@pytest.mark.parametrize("km", [5.0, 50.0, 400.0, 1500.0])
def test_document_is_cheaper_than_a_package_and_fragile_costs_more(km: float) -> None:
    document = _subtotal(_req(PackageType.LETTER_DOCUMENT), km)
    standard = _subtotal(_req(PackageType.STANDARD_PACKAGE), km)
    fragile = _subtotal(_req(PackageType.FRAGILE_ITEM), km)
    assert document < standard < fragile
    assert fragile == pytest.approx(standard * (1 + settings.fragile_surcharge))


def test_light_bulky_package_is_priced_by_its_volumetric_weight() -> None:
    tv = price_components(_req(weight_kg=8, sides=(105, 65, 15)), 500, GRID_FUEL_ARS_PER_L)
    assert tv.volumetric_weight_kg == pytest.approx(20.475)
    assert tv.billable_weight_kg == pytest.approx(20.475)
    # Cuesta lo mismo que un paquete compacto con ese peso real.
    compact = price_components(_req(weight_kg=20.475, sides=(40, 30, 25)), 500, GRID_FUEL_ARS_PER_L)
    assert tv.subtotal == pytest.approx(compact.subtotal)


def test_heavy_compact_package_is_priced_by_its_real_weight() -> None:
    c = price_components(_req(weight_kg=20, sides=(40, 30, 25)), 500, GRID_FUEL_ARS_PER_L)
    assert (c.volumetric_weight_kg, c.billable_weight_kg) == (6.0, 20.0)


def test_volumetric_divisor_comes_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "volumetric_divisor", 6000.0)
    c = price_components(_req(weight_kg=1, sides=(60, 50, 40)), 500, GRID_FUEL_ARS_PER_L)
    assert c.billable_weight_kg == pytest.approx(20.0)


def test_weight_beyond_the_tier_is_charged_at_the_reduced_rate() -> None:
    per_kg = settings.per_kg_l * GRID_FUEL_ARS_PER_L
    c = price_components(_req(weight_kg=30, sides=(10, 10, 10)), 0, GRID_FUEL_ARS_PER_L)
    assert c.weight == pytest.approx((10 + 20 * settings.weight_tier_rate) * per_kg)


# --- Límites duros (AC4) ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("weight", "sides"),
    [(30.0, (150, 100, 50)), (0.1, (100, 100, 100)), (30.0, (1, 1, 1))],
)
def test_packages_at_the_limits_are_accepted(weight: float, sides: tuple[float, float, float]) -> None:
    assert package_limit_violations(_req(weight_kg=weight, sides=sides)) == []


@pytest.mark.parametrize(
    ("weight", "sides", "expected"),
    [
        (30.5, (10, 10, 10), ["peso de 30.5 kg (máximo 30 kg)"]),
        (5.0, (151, 10, 10), ["lado de 151 cm (máximo 150 cm)"]),
        (5.0, (150, 100, 51), ["suma de lados de 301 cm (máximo 300 cm)"]),
        (31.0, (160, 100, 50), [
            "peso de 31 kg (máximo 30 kg)",
            "lado de 160 cm (máximo 150 cm)",
            "suma de lados de 310 cm (máximo 300 cm)",
        ]),
    ],
)
def test_packages_over_the_limits_are_rejected(
    weight: float, sides: tuple[float, float, float], expected: list[str]
) -> None:
    req = _req(weight_kg=weight, sides=sides)
    assert package_limit_violations(req) == expected
    with pytest.raises(PackageLimitsExceededError) as exc:
        asyncio.run(compute_quote(req, fuel_provider=GridFuel()))
    assert exc.value.violations == expected


def test_limits_come_from_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "package_max_weight_kg", 20.0)
    assert package_limit_violations(_req(weight_kg=25)) == ["peso de 25 kg (máximo 20 kg)"]


def test_endpoint_rejects_a_package_over_the_limits_with_a_clear_code() -> None:
    body = {
        "originLat": 0,
        "originLng": 0,
        "destinationLat": 1,
        "destinationLng": 0,
        "weightKg": 5,
        "lengthCm": 151,
        "widthCm": 10,
        "heightCm": 10,
        "packageType": "standard_package",
    }
    response = client.post("/quote", json=body)

    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "PACKAGE_LIMITS_EXCEEDED",
        "message": "El paquete excede los límites: lado de 151 cm (máximo 150 cm).",
        "violations": ["lado de 151 cm (máximo 150 cm)"],
    }
