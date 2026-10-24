"""Precio sugerido `package_tapered_v3` (MOVO-317, sobre `package_tapered_v2` de MOVO-276).

v3 es v2 con el peso volumétrico acotado a `volumetric_weight_cap_kg`. Reemplaza la parte de cálculo de `demand_fuel_routes_v1` (MOVO-138, ADR-025): misma
distancia por tramos, combustible y recargo por demanda, pero el paquete ahora cotiza por
su peso facturable (máximo entre real y volumétrico, con un tramo decreciente), con una
tarifa base por categoría y un recargo por frágil. Calibración contra el Correo en
`docs/pricing/grilla-referencia.md`; demanda y combustible en
`docs/pricing/pricing-spike-report.md` §3-§4.
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


def effective_distance_km(distance_km: float) -> float:
    """Km facturables con tarifa decreciente por tramos (ver `config.py`)."""
    t1 = settings.distance_tier1_km
    t2 = max(settings.distance_tier2_km, t1)
    tier1 = min(distance_km, t1)
    tier2 = max(min(distance_km, t2) - t1, 0.0)
    tier3 = max(distance_km - t2, 0.0)
    return tier1 + tier2 * settings.distance_tier2_rate + tier3 * settings.distance_tier3_rate


# MOVO-317: sin límites duros, `/quote` cotiza cualquier peso y medida. Hasta estos valores el
# método está calibrado contra el Correo (ADR-041 los usaba como tope); por encima se cotiza
# igual, pero extrapolando sin referencia de mercado, y la cotización lo avisa en el log
# `pricing_quote_computed` para medir cuántas caen fuera de la zona validada.
UNCALIBRATED_WEIGHT_KG = 30.0
UNCALIBRATED_SIDE_CM = 150.0


def uncalibrated_reasons(req: QuoteRequest) -> list[str]:
    """Qué del paquete cae fuera de la zona donde `package_tapered_v3` se calibró; vacío si
    está dentro. Solo informativo: nunca rechaza ni cambia el precio."""
    reasons = []
    if req.weight_kg > UNCALIBRATED_WEIGHT_KG:
        reasons.append(f"peso de {req.weight_kg:g} kg (calibrado hasta {UNCALIBRATED_WEIGHT_KG:g} kg)")
    longest = max(req.length_cm, req.width_cm, req.height_cm)
    if longest > UNCALIBRATED_SIDE_CM:
        reasons.append(f"lado de {longest:g} cm (calibrado hasta {UNCALIBRATED_SIDE_CM:g} cm)")
    return reasons


def volumetric_weight_kg(req: QuoteRequest) -> float:
    return req.length_cm * req.width_cm * req.height_cm / settings.volumetric_divisor


def effective_weight_kg(billable_kg: float) -> float:
    """Kg facturables con tarifa decreciente por tramo (ver `config.py`)."""
    tier = settings.weight_tier_kg
    return min(billable_kg, tier) + max(billable_kg - tier, 0.0) * settings.weight_tier_rate


@dataclass(frozen=True)
class PriceComponents:
    """Componentes en pesos, antes del recargo por demanda y del redondeo."""

    per_km_ars: float
    base: float
    distance: float
    weight: float
    package_factor: float
    volumetric_weight_kg: float
    billable_weight_kg: float

    @property
    def subtotal(self) -> float:
        return (self.base + self.distance + self.weight) * self.package_factor


def price_components(req: QuoteRequest, distance_km: float, ars_per_liter: float) -> PriceComponents:
    """Parte determinística de la fórmula, sin red, demanda ni redondeo: los tests de
    forma de la curva (monotonía, concavidad) la ejercitan directo."""
    p = ars_per_liter
    is_document = req.package_type == PackageType.LETTER_DOCUMENT
    is_fragile = req.package_type == PackageType.FRAGILE_ITEM
    per_km_ars = (settings.fuel_l_per_km * settings.fuel_cost_share + settings.non_fuel_l_per_km) * p
    volumetric = volumetric_weight_kg(req)
    # MOVO-317: el volumétrico cuenta hasta el tope; el peso real no tiene tope.
    billable = max(req.weight_kg, min(volumetric, settings.volumetric_weight_cap_kg))
    return PriceComponents(
        per_km_ars=per_km_ars,
        base=(settings.base_fare_document_l if is_document else settings.base_fare_l) * p,
        distance=effective_distance_km(distance_km) * per_km_ars,
        weight=effective_weight_kg(billable) * settings.per_kg_l * p,
        package_factor=1.0 + settings.fragile_surcharge if is_fragile else 1.0,
        volumetric_weight_kg=volumetric,
        billable_weight_kg=billable,
    )


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
    c = price_components(req, distance_km, p)
    uncalibrated = uncalibrated_reasons(req)
    if uncalibrated:
        logger.warning("pricing_quote_uncalibrated_package %s", "; ".join(uncalibrated))
    demand = demand_multiplier(req.demand_context)
    suggested_price_ars = _round_to_10(c.subtotal * demand.multiplier)

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
                "perKmArs": round(c.per_km_ars, 2),
                "base": round(c.base, 2),
                "distance": round(c.distance, 2),
                "weight": round(c.weight, 2),
                "packageFactor": c.package_factor,
                "volumetricWeightKg": round(c.volumetric_weight_kg, 2),
                "billableWeightKg": round(c.billable_weight_kg, 2),
                "calibrated": not uncalibrated,
                "volumetricCapped": c.volumetric_weight_kg > settings.volumetric_weight_cap_kg,
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
            per_km_ars=round(c.per_km_ars, 2),
            base=round(c.base, 2),
            distance=round(c.distance, 2),
            weight=round(c.weight, 2),
            package_factor=c.package_factor,
            volumetric_weight_kg=round(c.volumetric_weight_kg, 2),
            billable_weight_kg=round(c.billable_weight_kg, 2),
            demand_ratio=round(demand.ratio, 2),
            demand_multiplier=demand.multiplier,
        )
        if req.include_breakdown
        else None
    )

    return QuoteResponse(
        suggested_price_ars=suggested_price_ars,
        high_demand=demand.high_demand,
        calculation_method=PriceCalculationMethod.PACKAGE_TAPERED_V3,
        breakdown=breakdown,
    )
