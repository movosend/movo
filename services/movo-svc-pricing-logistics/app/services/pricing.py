"""Precio sugerido `demand_fuel_routes_v1` (MOVO-138, ADR-025).

Reemplaza a `euclidean_linear_v1` (MOVO-82, ADR-018). Fórmula, calibración y
decisiones en `docs/pricing/pricing-spike-report.md` §4-§7.
"""

import asyncio
import json
import logging
import math
from dataclasses import dataclass
from typing import Literal

from app.config import settings
from app.models.optimize import Coordinates
from app.models.quote import (
    DemandContext,
    PackageType,
    PriceCalculationMethod,
    QuoteBreakdown,
    QuoteRequest,
    QuoteResponse,
)
from app.services.distance import haversine_distance_km
from app.services.fuel_price import FuelPriceProvider, get_fuel_price_provider
from app.services.routes_provider import MockRoutesProvider, RoutesProvider, get_routes_provider

logger = logging.getLogger(__name__)

# Línea recta → distancia por ruta. Se aplica al mock de rutas (que devuelve Haversine
# puro) y al fallback cuando Google falla.
ROAD_DETOUR_FACTOR = 1.3
# Deja margen para degradar a Haversine dentro de los 3s de `pricing-client.ts`
# (`movo-svc-shipments`), en vez de los 5s que usa el ruteo. Corre en paralelo con la
# consulta de combustible (`FETCH_TIMEOUT_SECONDS`, 2s): el peor caso es el mayor de
# los dos topes, no la suma.
QUOTE_ROUTES_TIMEOUT_SECONDS = 1.5

DistanceSource = Literal["routes_api", "haversine_mock", "haversine_fallback"]


@dataclass(frozen=True)
class DemandResult:
    ratio: float
    high_demand: bool
    multiplier: float


def demand_multiplier(ctx: DemandContext | None) -> DemandResult:
    """`demanda = publicados en la zona + 1` (el envío que se cotiza);
    `ratio = demanda / max(transportistas, 1)`.

    Alta demanda si `demanda >= mínimo` y `ratio >= umbral`. El recargo salta de 0 al
    recargo base al cruzar el umbral en vez de arrancar suave: así `highDemand` es
    verdadero si y solo si hay recargo, y el emisor nunca ve uno sin el otro.
    """
    if ctx is None:
        return DemandResult(ratio=0.0, high_demand=False, multiplier=1.0)

    demand = ctx.published_shipments + 1
    ratio = demand / max(ctx.available_carriers, 1)
    if demand < settings.demand_min_shipments or ratio < settings.demand_ratio_threshold:
        return DemandResult(ratio=ratio, high_demand=False, multiplier=1.0)

    surcharge = min(
        settings.demand_max_surcharge,
        settings.demand_base_surcharge + settings.demand_slope * (ratio - settings.demand_ratio_threshold),
    )
    return DemandResult(ratio=ratio, high_demand=True, multiplier=round(1.0 + surcharge, 4))


async def road_distance_km(
    routes: RoutesProvider | None, origin: Coordinates, destination: Coordinates
) -> tuple[float, DistanceSource]:
    """Si Google falla (caído, timeout, cuota agotada, sin ruta), `/quote` NO propaga el
    502: degrada a Haversine x 1,3. Excepción acotada a la política No-Fallback de
    MOVO-205, que sigue vigente para `/optimize/route` y `/routes/evaluate-candidates`:
    acá el resultado es un precio sugerido y editable, no instrucciones de ruta."""
    straight_km = haversine_distance_km(origin.lat, origin.lng, destination.lat, destination.lng)
    try:
        provider = routes or get_routes_provider(timeout=QUOTE_ROUTES_TIMEOUT_SECONDS)
        # El provider es sync (httpx.Client): se corre fuera del event loop. El timeout de
        # httpx es por fase (connect, read...), no total: `wait_for` pone el tope real.
        # El thread sigue hasta que httpx corta, pero la cotización ya degradó a tiempo.
        km = await asyncio.wait_for(
            asyncio.to_thread(provider.compute_route_km, origin, destination),
            QUOTE_ROUTES_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 — cualquier falla del proveedor degrada igual
        logger.warning("quote_routes_provider_failed_using_haversine error=%s", exc)
        return straight_km * ROAD_DETOUR_FACTOR, "haversine_fallback"

    if isinstance(provider, MockRoutesProvider):
        # El mock devuelve línea recta: sin el factor, dev/CI cotizarían ~30% por debajo
        # de lo que cotiza Google.
        return km * ROAD_DETOUR_FACTOR, "haversine_mock"
    if km <= 0 < straight_km:
        logger.warning("quote_routes_provider_zero_distance_using_haversine")
        return straight_km * ROAD_DETOUR_FACTOR, "haversine_fallback"
    return km, "routes_api"


def _package_factor(package_type: PackageType) -> float:
    return {
        PackageType.LETTER_DOCUMENT: settings.factor_letter_document,
        PackageType.STANDARD_PACKAGE: settings.factor_standard_package,
        PackageType.FRAGILE_ITEM: settings.factor_fragile_item,
    }[package_type]


def _round_to_10(value: float) -> float:
    """Redondeo a $10, mitad hacia arriba (`round()` de Python redondea al par)."""
    return float(math.floor(value / 10 + 0.5) * 10)


async def compute_quote(
    req: QuoteRequest,
    fuel_provider: FuelPriceProvider | None = None,
    routes: RoutesProvider | None = None,
) -> QuoteResponse:
    # Independientes entre sí: en serie, el peor caso (2s + 1,5s) pasaba los 3s de
    # `pricing-client.ts` y el envío quedaba en "precio a estimar".
    fuel, (distance_km, distance_source) = await asyncio.gather(
        (fuel_provider or get_fuel_price_provider()).get_price(),
        road_distance_km(
            routes,
            Coordinates(lat=req.origin_lat, lng=req.origin_lng),
            Coordinates(lat=req.destination_lat, lng=req.destination_lng),
        ),
    )

    p = fuel.ars_per_liter
    base = settings.base_fare_l * p
    per_km_ars = (settings.fuel_l_per_km * settings.fuel_cost_share + settings.non_fuel_l_per_km) * p
    distance_component = distance_km * per_km_ars
    weight_component = req.weight_kg * settings.per_kg_l * p
    package_factor = _package_factor(req.package_type)
    subtotal = (base + distance_component + weight_component) * package_factor

    demand = demand_multiplier(req.demand_context)
    suggested_price_ars = _round_to_10(subtotal * demand.multiplier)

    # El desglose no viaja al emisor (spike §6.2): se loguea para recalibrar los
    # parámetros con datos reales. No sirve como evidencia de disputas (MOVO-30): la
    # cotización ocurre antes de que exista el envío, el log no lleva `shipmentId` ni
    # `x-request-id`, y la rotación de `json-file` no lo hace durable.
    logger.info(
        "pricing_quote_computed %s",
        json.dumps(
            {
                "suggestedPriceArs": suggested_price_ars,
                "highDemand": demand.high_demand,
                "fuelArsPerLiter": p,
                "fuelSource": fuel.source,
                "distanceKm": round(distance_km, 2),
                "distanceSource": distance_source,
                "perKmArs": round(per_km_ars, 2),
                "base": round(base, 2),
                "distance": round(distance_component, 2),
                "weight": round(weight_component, 2),
                "packageFactor": package_factor,
                "demandContext": req.demand_context.model_dump(by_alias=True) if req.demand_context else None,
                "demandRatio": round(demand.ratio, 2),
                "demandMultiplier": demand.multiplier,
            }
        ),
    )

    breakdown = (
        QuoteBreakdown(
            distance_km=round(distance_km, 2),
            distance_source=distance_source,
            fuel_ars_per_liter=p,
            fuel_source=fuel.source,
            per_km_ars=round(per_km_ars, 2),
            base=round(base, 2),
            distance=round(distance_component, 2),
            weight=round(weight_component, 2),
            package_factor=package_factor,
            demand_ratio=round(demand.ratio, 2),
            demand_multiplier=demand.multiplier,
        )
        if req.include_breakdown
        else None
    )

    return QuoteResponse(
        suggested_price_ars=suggested_price_ars,
        high_demand=demand.high_demand,
        calculation_method=PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1,
        breakdown=breakdown,
    )
