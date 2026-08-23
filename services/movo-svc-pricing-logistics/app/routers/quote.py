from fastapi import APIRouter

from app.models.quote import QuoteRequest, QuoteResponse
from app.services.pricing import compute_quote

router = APIRouter()


@router.post(
    "/quote",
    response_model=QuoteResponse,
    summary="Precio sugerido para un envío (implementación provisoria, MOVO-82)",
    description=(
        "Calcula `suggestedPriceArs` con la fórmula lineal provisoria "
        "(`calculationMethod: euclidean_linear_v1`) — distancia euclidiana entre "
        "origen y destino, peso y un factor según `packageType`. Reemplazada a "
        "futuro por el motor de precios real (demanda + combustible + Google Routes "
        "API) sin cambiar este contrato."
    ),
)
def create_quote(request: QuoteRequest) -> QuoteResponse:
    return compute_quote(request)
