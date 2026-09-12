from datetime import datetime

from pydantic import Field

from app.models.quote import CamelModel


class TripContext(CamelModel):
    """Información del viaje del transportista sobre el cual evaluar candidatos."""

    id: str = Field(description="Identificador único del viaje (UUID)")
    origin_lat: float = Field(ge=-90.0, le=90.0, description="Latitud de origen")
    origin_lng: float = Field(ge=-180.0, le=180.0, description="Longitud de origen")
    destination_lat: float = Field(ge=-90.0, le=90.0, description="Latitud de destino")
    destination_lng: float = Field(ge=-180.0, le=180.0, description="Longitud de destino")
    departure_at: datetime | str = Field(
        description="Fecha y hora de partida del viaje (ISO 8601 o string de fecha)"
    )


class CandidatePackage(CamelModel):
    """Paquete prefiltrado geométricamente para evaluar desvío marginal."""

    id: str = Field(description="Identificador único del paquete candidato")
    pickup_lat: float = Field(ge=-90.0, le=90.0)
    pickup_lng: float = Field(ge=-180.0, le=180.0)
    pickup_window_start: str | datetime | None = Field(
        default=None,
        description="Inicio de ventana horaria de retiro (opcional)",
    )
    pickup_window_end: str | datetime | None = Field(
        default=None,
        description="Fin de ventana horaria de retiro (opcional)",
    )
    dropoff_lat: float = Field(ge=-90.0, le=90.0)
    dropoff_lng: float = Field(ge=-180.0, le=180.0)
    dropoff_window_start: str | datetime | None = Field(
        default=None,
        description="Inicio de ventana horaria de entrega (opcional)",
    )
    dropoff_window_end: str | datetime | None = Field(
        default=None,
        description="Fin de ventana horaria de entrega (opcional)",
    )
    service_time_minutes: int | None = Field(
        default=None,
        ge=0,
        description="Tiempo de servicio en minutos por parada (default según settings)",
    )


class EvaluateCandidatesRequest(CamelModel):
    """Payload de entrada para POST /routes/evaluate-candidates (MOVO-218)."""

    trip: TripContext = Field(description="Contexto del viaje base")
    candidates: list[CandidatePackage] = Field(
        default_factory=list,
        max_length=25,
        description="Lista de paquetes candidatos (máximo 25 para SLA < 500ms)",
    )


class CandidateEvaluation(CamelModel):
    """Resultado de la evaluación de un candidato individual."""

    candidate_id: str = Field(description="Identificador del paquete evaluado")
    feasible: bool = Field(description="True si la inserción es factible dentro de las restricciones")
    detour_distance_km: float | None = Field(
        default=None,
        description="Kilómetros adicionales respecto al trayecto directo",
    )
    detour_duration_minutes: int | None = Field(
        default=None,
        description="Minutos adicionales respecto al trayecto directo",
    )
    total_distance_km: float | None = Field(
        default=None,
        description="Distancia total acumulada del recorrido con este desvío en km",
    )
    total_duration_minutes: int | None = Field(
        default=None,
        description="Duración total estimada del viaje con este desvío en minutos",
    )


class EvaluateCandidatesResponse(CamelModel):
    """Respuesta con el desvío marginal y métricas de cada candidato evaluado."""

    direct_distance_km: float = Field(description="Distancia directa origen -> destino en km")
    direct_duration_minutes: int = Field(description="Tiempo directo origen -> destino en minutos")
    evaluations: list[CandidateEvaluation] = Field(
        description="Lista de evaluaciones de los candidatos solicitados"
    )
    calculation_method: str = Field(
        default="haversine_vrptw_v1",
        description="Método/proveedor utilizado para las métricas de distancia y ruteo",
    )
