from fastapi import APIRouter, HTTPException, status

from app.models.optimize import OptimizeRouteRequest, OptimizeRouteResponse
from app.services.routes_provider import RoutesProviderError
from app.services.vrptw_solver import RoutingInfeasibleError, optimize_route

router = APIRouter()


@router.post(
    "/optimize/route",
    response_model=OptimizeRouteResponse,
    status_code=status.HTTP_200_OK,
    summary="Optimización de ruta multi-envío VRPTW (MOVO-205)",
    description=(
        "Secuencia de paradas óptima para un transportista con múltiples envíos asignados "
        "o en evaluación. Resuelve el problema de ruteo con ventanas de tiempo (VRPTW) "
        "mediante Google OR-Tools, imponiendo precedencia estricta (retiro antes que entrega), "
        "reportando paradas fuera de ventana (outsideTimeWindow) si la agenda es apretada, "
        "y aplicando una política estricta de No-Fallback ante fallas del solver o de la API externa."
    ),
    responses={
        200: {"description": "Ruta optimizada exitosamente."},
        422: {"description": "Ruta irresoluble o violación de restricciones de precedencia."},
        502: {"description": "Error en el proveedor externo de rutas (Google Routes API)."},
        503: {"description": "Proveedor de rutas no disponible o cuota agotada."},
    },
)
def optimize_carrier_route(request: OptimizeRouteRequest) -> OptimizeRouteResponse:
    try:
        return optimize_route(request)
    except RoutingInfeasibleError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except RoutesProviderError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=str(exc),
        ) from exc
