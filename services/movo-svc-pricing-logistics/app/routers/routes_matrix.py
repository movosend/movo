from fastapi import APIRouter, HTTPException, status

from app.models.optimize import RouteMatrixRequest, RouteMatrixResponse
from app.services.routes_provider import RoutesProviderError, get_routes_provider

router = APIRouter()


@router.post(
    "/routes/matrix",
    response_model=RouteMatrixResponse,
    status_code=status.HTTP_200_OK,
    summary="Matriz de distancias y tiempos entre puntos",
    description=(
        "Matriz NxN (hasta 25 puntos) del RoutesProvider configurado, sin optimizar. La pide "
        "el módulo demo de `movo-svc-shipments` (juego del optimizador de la feria) una sola "
        "vez por ciudad para cachearla y pasarla después a `POST /optimize/route` en "
        "`matrix`, así cada partida no vuelve a facturar elementos de Google Routes."
    ),
    responses={
        502: {"description": "Error en el proveedor externo de rutas (Google Routes API)."},
        503: {"description": "Proveedor de rutas no disponible o cuota agotada."},
    },
)
def compute_route_matrix(request: RouteMatrixRequest) -> RouteMatrixResponse:
    try:
        result = get_routes_provider().compute_matrix(request.points)
    except RoutesProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    n = len(request.points)
    return RouteMatrixResponse(
        dist_km=result.dist_matrix_km,
        time_min=result.time_matrix_min,
        provider=result.provider_name,
        elements_billed=0 if result.provider_name == "haversine_mock" else n * n,
    )
