from fastapi import APIRouter, HTTPException, status

from app.models.evaluate import EvaluateCandidatesRequest, EvaluateCandidatesResponse
from app.services.candidate_evaluator import CandidateEvaluator
from app.services.routes_provider import RoutesProviderError

router = APIRouter()


@router.post(
    "/routes/evaluate-candidates",
    response_model=EvaluateCandidatesResponse,
    status_code=status.HTTP_200_OK,
    summary="Evaluación de desvío marginal para paquetes candidatos en un viaje (MOVO-218)",
    description=(
        "Evalúa para una lista de hasta 25 paquetes candidatos el desvío marginal en distancia (km) "
        "y tiempo (minutos) que representaría insertarlos en el viaje de un transportista. "
        "Modela el circuito de 4 nodos (Origen -> Retiro -> Entrega -> Destino) con Google OR-Tools, "
        "imponiendo precedencia obligatoria y ventanas horarias con holgura de 120 minutos. "
        "Aplica estrategia Cache-First con Redis (TTL 30 min) y política estricta de No-Fallback."
    ),
    responses={
        200: {"description": "Evaluaciones procesadas exitosamente."},
        422: {"description": "Error de validación o parámetros inviables."},
        502: {"description": "Error en el proveedor externo de rutas (Google Routes API)."},
        503: {"description": "Proveedor de rutas no disponible o cuota agotada."},
    },
)
async def evaluate_candidates_route(
    request: EvaluateCandidatesRequest,
) -> EvaluateCandidatesResponse:
    evaluator = CandidateEvaluator()
    try:
        return await evaluator.evaluate_candidates(request)
    except RoutesProviderError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
