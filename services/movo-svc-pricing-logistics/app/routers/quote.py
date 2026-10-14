from fastapi import APIRouter, HTTPException, status

from app.models.quote import QuoteRequest, QuoteResponse
from app.services.pricing import PackageLimitsExceededError, compute_quote

router = APIRouter()


@router.post(
    "/quote",
    response_model=QuoteResponse,
    response_model_exclude_none=True,
    summary="Precio sugerido para un envío (package_tapered_v2, MOVO-276)",
    description=(
        "Calcula `suggestedPriceArs` con `calculationMethod: package_tapered_v2`: distancia "
        "por ruta (Google Routes API, o Haversine x 1,3 si falla) con tarifa decreciente por "
        "tramos, peso facturable (máximo entre el real y el volumétrico L x A x H / divisor) "
        "con un tramo decreciente, tarifa base según `packageType` (menor para documentos) y "
        "recargo por `fragile_item`, todo en litros de nafta al precio de surtidor, más un "
        "recargo de 10% a 30% si `demandContext` indica alta demanda en la zona de retiro "
        "(ADR-025). `highDemand` es `true` si y solo si se aplicó ese recargo. Sin desglose "
        "en la respuesta: queda en el log `pricing_quote_computed`. Excepción: "
        "`includeBreakdown: true` lo devuelve en `breakdown`; solo lo usa el módulo demo de "
        "`movo-svc-shipments` (juego de precios), nunca el flujo del emisor."
    ),
    responses={
        422: {
            "description": (
                "Body inválido, o paquete fuera de los límites duros "
                "(`detail.code: PACKAGE_LIMITS_EXCEEDED`, con `detail.violations`)."
            )
        },
    },
)
async def create_quote(request: QuoteRequest) -> QuoteResponse:
    try:
        return await compute_quote(request)
    except PackageLimitsExceededError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "PACKAGE_LIMITS_EXCEEDED",
                "message": str(exc),
                "violations": exc.violations,
            },
        ) from exc
