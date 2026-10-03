from fastapi import APIRouter

from app.models.quote import QuoteRequest, QuoteResponse
from app.services.pricing import compute_quote

router = APIRouter()


@router.post(
    "/quote",
    response_model=QuoteResponse,
    response_model_exclude_none=True,
    summary="Precio sugerido para un envío (demand_fuel_routes_v1, MOVO-138)",
    description=(
        "Calcula `suggestedPriceArs` con `calculationMethod: demand_fuel_routes_v1` "
        "(ADR-025): distancia por ruta (Google Routes API, o Haversine x 1,3 si falla), "
        "tarifa en litros de nafta al precio de surtidor, peso, factor según "
        "`packageType` y recargo de 10% a 30% si `demandContext` indica alta demanda en "
        "la zona de retiro. `highDemand` es `true` si y solo si se aplicó ese recargo. "
        "Sin desglose en la respuesta: queda en el log `pricing_quote_computed`. "
        "Excepción: `includeBreakdown: true` lo devuelve en `breakdown`; solo lo usa el "
        "módulo demo de `movo-svc-shipments` (juego de precios), nunca el flujo del emisor."
    ),
)
async def create_quote(request: QuoteRequest) -> QuoteResponse:
    return await compute_quote(request)
