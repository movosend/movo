import math

from app.config import settings
from app.models.quote import PackageType, PriceBreakdownItem, PriceCalculationMethod, QuoteRequest, QuoteResponse

# Grados de latitud/longitud a metros (aproximación equirectangular, precisión de
# sobra para las distancias urbanas/interurbanas de Argentina que maneja MOVO).
KM_PER_DEGREE_LAT = 111.32

_PACKAGE_TYPE_FACTORS = {
    PackageType.LETTER_DOCUMENT: settings.factor_letter_document,
    PackageType.STANDARD_PACKAGE: settings.factor_standard_package,
    PackageType.FRAGILE_ITEM: settings.factor_fragile_item,
}


def _euclidean_distance_km(req: QuoteRequest) -> float:
    """AC3 pide explícitamente "distancia euclidiana entre coordenadas" — no
    Haversine/geodésica (a diferencia del cálculo que hace `movo-svc-shipments` para
    validar que retiro y entrega no sean el mismo punto, MOVO-126). Una distancia
    euclidiana sobre grados crudos no tiene unidades de distancia sensatas, así que
    se proyectan los grados a km sobre un plano local (aproximación equirectangular:
    la longitud se escala por `cos(latitud promedio)` porque los meridianos se juntan
    hacia los polos) y recién ahí se aplica Pitágoras — sigue siendo una distancia
    euclidiana (línea recta en el plano proyectado), no la geodésica real.
    """
    avg_lat_rad = math.radians((req.origin_lat + req.destination_lat) / 2)
    km_per_degree_lng = KM_PER_DEGREE_LAT * math.cos(avg_lat_rad)

    dlat_km = (req.destination_lat - req.origin_lat) * KM_PER_DEGREE_LAT
    dlng_km = (req.destination_lng - req.origin_lng) * km_per_degree_lng

    return math.sqrt(dlat_km**2 + dlng_km**2)


def compute_quote(req: QuoteRequest) -> QuoteResponse:
    """Fórmula lineal provisoria (MOVO-82, ADR-017): `base + distanciaKm*tarifaKm +
    pesoKg*tarifaKg`, escalada por un factor según `packageType`. Determinística, sin
    I/O — reemplazar por el motor real (demanda + combustible + Google Routes API,
    ver backlog) sin tocar el contrato de `POST /quote` (AC10)."""
    distance_km = _euclidean_distance_km(req)

    base = settings.base_fare_ars
    distance_component = distance_km * settings.price_per_km_ars
    weight_component = req.weight_kg * settings.price_per_kg_ars
    subtotal = base + distance_component + weight_component

    factor = _PACKAGE_TYPE_FACTORS[req.package_type]
    suggested_price_ars = round(subtotal * factor, 2)

    breakdown = [
        PriceBreakdownItem(label="base", amount_ars=round(base, 2)),
        PriceBreakdownItem(label="distancia", amount_ars=round(distance_component, 2)),
        PriceBreakdownItem(label="peso", amount_ars=round(weight_component, 2)),
    ]
    if factor != 1.0:
        breakdown.append(
            PriceBreakdownItem(label="factor_tipo_paquete", amount_ars=round(subtotal * (factor - 1.0), 2))
        )

    return QuoteResponse(
        suggested_price_ars=suggested_price_ars,
        breakdown=breakdown,
        calculation_method=PriceCalculationMethod.EUCLIDEAN_LINEAR_V1,
    )
