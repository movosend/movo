from datetime import datetime
from enum import Enum

from pydantic import Field

from app.models.quote import CamelModel


class StopType(str, Enum):
    PICKUP = "pickup"
    DELIVERY = "delivery"


class OptimizationStatus(str, Enum):
    OPTIMAL = "OPTIMAL"
    FEASIBLE = "FEASIBLE"
    EMPTY = "EMPTY"


class Coordinates(CamelModel):
    lat: float = Field(ge=-90.0, le=90.0, description="Latitud en grados decimales")
    lng: float = Field(ge=-180.0, le=180.0, description="Longitud en grados decimales")


class RouteStopInput(CamelModel):
    """Parada de la ruta solicitada por el transportista o agregada por svc-shipments."""

    shipment_id: str = Field(description="Identificador del envío")
    type: StopType = Field(description="Tipo de parada: 'pickup' o 'delivery'")
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    address: str | None = Field(default=None, description="Dirección legible (opcional)")
    time_window_start: str | datetime | None = Field(
        default=None,
        description="Inicio de ventana horaria (ISO 8601 o 'HH:MM:SS')",
    )
    time_window_end: str | datetime | None = Field(
        default=None,
        description="Fin de ventana horaria (ISO 8601 o 'HH:MM:SS')",
    )
    service_time_minutes: int | None = Field(
        default=None,
        ge=0,
        description="Tiempo de permanencia en la parada en minutos (default según settings)",
    )


class OptimizationObjective(str, Enum):
    TIME = "time"
    DISTANCE = "distance"


class PrecomputedMatrix(CamelModel):
    """Matriz ya calculada (ej. cacheada por el juego del optimizador de la feria).

    Orden canónico: [carrierLocation, pickups (orden de entrada), deliveries (orden de
    entrada), finalLocation si vino]. Con solo entregas coincide con el orden de `stops`.
    """

    dist_km: list[list[float]]
    time_min: list[list[int]]


class OptimizeRouteRequest(CamelModel):
    """Payload de entrada para POST /optimize/route (MOVO-205)."""

    carrier_location: Coordinates = Field(
        description="Posición actual del transportista al momento de optimizar"
    )
    stops: list[RouteStopInput] = Field(
        default_factory=list,
        description="Lista de paradas asignadas o a evaluar para el transportista",
    )
    departure_time: str | datetime | None = Field(
        default=None,
        description="Hora estimada de partida (ISO 8601 o 'HH:MM:SS'). Default: momento actual",
    )
    final_location: Coordinates | None = Field(
        default=None,
        description="Destino final declarado del viaje si aplica (para ruta cerrada/corredor)",
    )
    # Opt-in del módulo demo de `movo-svc-shipments` (juego del optimizador): el flujo de
    # transportistas sigue minimizando tiempo y pidiendo la matriz al provider.
    objective: OptimizationObjective = Field(
        default=OptimizationObjective.TIME,
        description="Costo a minimizar: 'time' (default) o 'distance'",
    )
    matrix: PrecomputedMatrix | None = Field(
        default=None,
        description="Matriz precalculada en orden canónico; si viene, no se consulta al provider",
    )


class RouteStopOutput(CamelModel):
    """Parada secuenciada en la ruta óptima con su tiempo estimado de arribo (ETA)."""

    stop_order: int = Field(description="Índice de la parada en la ruta secuenciada (0, 1, ...)")
    shipment_id: str = Field(description="Identificador del envío")
    type: StopType = Field(description="Tipo de parada: 'pickup' o 'delivery'")
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    address: str | None = Field(default=None)
    estimated_arrival_minutes: float = Field(
        description="Minutos transcurridos desde la partida hasta el arribo a esta parada"
    )
    estimated_arrival_at: str | None = Field(
        default=None,
        description="Timestamp ISO 8601 del arribo estimado",
    )
    estimated_departure_at: str | None = Field(
        default=None,
        description="Timestamp ISO 8601 de la partida estimada tras el tiempo de servicio",
    )
    time_window_start: str | None = Field(default=None)
    time_window_end: str | None = Field(default=None)
    outside_time_window: bool = Field(
        default=False,
        description="True si el arribo estimado excede la ventana horaria pactada",
    )


class OptimizeRouteResponse(CamelModel):
    """Respuesta de POST /optimize/route con la secuencia de paradas ordenada y métricas globales."""

    stops: list[RouteStopOutput] = Field(
        description="Lista ordenada de paradas optimizadas por OR-Tools"
    )
    total_distance_km: float = Field(description="Distancia total acumulada del recorrido en km")
    total_duration_minutes: float = Field(
        description="Duración total estimada del viaje en minutos (traslado + atención)"
    )
    status: OptimizationStatus = Field(description="Estado de convergencia del solver")
    calculation_method: str = Field(
        description="Método/proveedor utilizado (ej. haversine_vrptw_v1 o google_routes_vrptw_v1)"
    )
    disclaimer: str = Field(
        description="Aclaración técnica sobre la naturaleza geométrica o vial del cálculo de tiempos"
    )


# Google Compute Route Matrix acepta hasta 625 elementos por request (25x25).
ROUTE_MATRIX_MAX_POINTS = 25


class RouteMatrixRequest(CamelModel):
    """Payload de POST /routes/matrix: matriz NxN entre todos los puntos."""

    points: list[Coordinates] = Field(
        min_length=2,
        max_length=ROUTE_MATRIX_MAX_POINTS,
        description="Puntos (2 a 25); la matriz respeta este orden en filas y columnas",
    )


class RouteMatrixResponse(CamelModel):
    dist_km: list[list[float]] = Field(description="Distancias en km, dist_km[i][j] de i a j")
    time_min: list[list[int]] = Field(description="Tiempos de manejo en minutos")
    provider: str = Field(description="Proveedor usado: 'google_routes' o 'haversine_mock'")
    elements_billed: int = Field(
        description="Elementos facturables pedidos al proveedor (0 si es el mock sin costo)"
    )
