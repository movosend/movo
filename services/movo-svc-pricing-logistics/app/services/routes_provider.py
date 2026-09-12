from abc import ABC, abstractmethod
from dataclasses import dataclass
import logging
import math
from typing import Any

import httpx

from app.config import settings
from app.models.optimize import Coordinates
from app.services.distance import haversine_distance_km, haversine_travel_time_minutes

logger = logging.getLogger(__name__)

GOOGLE_ROUTES_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
FIELD_MASK = "originIndex,destinationIndex,duration,distanceMeters,status"
REQUEST_TIMEOUT_SECONDS = 5.0


class RoutesProviderError(Exception):
    """Excepción lanzada cuando el proveedor externo de rutas falla o agota cuota (No-Fallback)."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class DistanceMatrixResult:
    dist_matrix_km: list[list[float]]
    time_matrix_min: list[list[int]]
    provider_name: str


class RoutesProvider(ABC):
    """Interfaz abstracta para cálculo de matrices de distancia y tiempo (ADR-013 / ADR-015)."""

    @abstractmethod
    def compute_matrix(self, waypoints: list[Coordinates]) -> DistanceMatrixResult:
        """Calcula las matrices NxN de distancias (km) y tiempos (min) entre todos los waypoints."""
        pass


class MockRoutesProvider(RoutesProvider):
    """Proveedor determinístico basado en Haversine y velocidad promedio (ADR-013).

    Utilizado por default en dev, test y CI sin costo de API keys.
    """

    def __init__(self, avg_speed_kmh: float = 40.0):
        self.avg_speed_kmh = avg_speed_kmh

    def compute_matrix(self, waypoints: list[Coordinates]) -> DistanceMatrixResult:
        n = len(waypoints)
        dist_matrix: list[list[float]] = []
        time_matrix: list[list[int]] = []

        for i in range(n):
            row_d: list[float] = []
            row_t: list[int] = []
            for j in range(n):
                if i == j:
                    row_d.append(0.0)
                    row_t.append(0)
                else:
                    d = haversine_distance_km(
                        waypoints[i].lat, waypoints[i].lng, waypoints[j].lat, waypoints[j].lng
                    )
                    t = haversine_travel_time_minutes(
                        waypoints[i].lat,
                        waypoints[i].lng,
                        waypoints[j].lat,
                        waypoints[j].lng,
                        self.avg_speed_kmh,
                    )
                    row_d.append(d)
                    row_t.append(t)
            dist_matrix.append(row_d)
            time_matrix.append(row_t)

        return DistanceMatrixResult(
            dist_matrix_km=dist_matrix,
            time_matrix_min=time_matrix,
            provider_name="haversine_mock",
        )


class GoogleRoutesProvider(RoutesProvider):
    """Proveedor real sobre Google Routes API (Compute Route Matrix, tier Basic, ADR-015).

    Aplica la política estricta de No-Fallback: si la API falla o supera cuota, lanza
    RoutesProviderError (HTTP 502/503) en lugar de retornar estimaciones silenciosas.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = GOOGLE_ROUTES_MATRIX_URL,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
    ):
        self.api_key = api_key
        self.base_url = base_url
        self.timeout = timeout

    def compute_matrix(self, waypoints: list[Coordinates]) -> DistanceMatrixResult:
        n = len(waypoints)
        if n <= 1:
            return DistanceMatrixResult(
                dist_matrix_km=[[0.0] * n for _ in range(n)],
                time_matrix_min=[[0] * n for _ in range(n)],
                provider_name="google_routes",
            )

        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        }

        # Estructura del body con waypoints ordenados canónicamente
        waypoint_specs = [
            {"waypoint": {"location": {"latLng": {"latitude": w.lat, "longitude": w.lng}}}}
            for w in waypoints
        ]

        payload = {
            "origins": waypoint_specs,
            "destinations": waypoint_specs,
            "travelMode": "DRIVE",
        }

        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(self.base_url, headers=headers, json=payload)
        except Exception as exc:
            logger.error("Error conectando con Google Routes API: %s", exc)
            raise RoutesProviderError(
                "No se pudo conectar con el proveedor de rutas (Google Routes API)."
            ) from exc

        if response.status_code != 200:
            logger.error(
                "Google Routes API respondió con status %d: %s",
                response.status_code,
                response.text,
            )
            status_code = 503 if response.status_code in (429, 503) else 502
            raise RoutesProviderError(
                f"Google Routes API devolvió un error (HTTP {response.status_code}).",
                status_code=status_code,
            )

        try:
            elements: list[dict[str, Any]] = response.json()
        except Exception as exc:
            logger.error("Respuesta inválida de Google Routes API: %s", exc)
            raise RoutesProviderError(
                "Formato inesperado devuelto por Google Routes API."
            ) from exc

        dist_matrix = [[0.0] * n for _ in range(n)]
        time_matrix = [[0] * n for _ in range(n)]

        for elem in elements:
            # Si el elemento contiene un error de enrutamiento
            if "status" in elem and elem["status"].get("code", 0) != 0:
                logger.warning("Elemento no enrutable en matriz: %s", elem["status"])
                continue

            orig_idx = elem.get("originIndex")
            dest_idx = elem.get("destinationIndex")
            if orig_idx is None or dest_idx is None:
                continue

            dist_meters = elem.get("distanceMeters", 0)
            duration_str = elem.get("duration", "0s")
            duration_seconds = int(duration_str.rstrip("s")) if duration_str.endswith("s") else 0

            dist_matrix[orig_idx][dest_idx] = round(dist_meters / 1000.0, 3)
            time_matrix[orig_idx][dest_idx] = math.ceil(duration_seconds / 60.0)

        return DistanceMatrixResult(
            dist_matrix_km=dist_matrix,
            time_matrix_min=time_matrix,
            provider_name="google_routes",
        )


def get_routes_provider() -> RoutesProvider:
    """Factory de RoutesProvider según la variable de entorno ROUTES_PROVIDER."""
    provider_type = settings.routes_provider.lower().strip()
    if provider_type == "google":
        if not settings.google_maps_api_key:
            raise RoutesProviderError(
                "ROUTES_PROVIDER=google requiere GOOGLE_MAPS_API_KEY configurada.",
                status_code=500,
            )
        return GoogleRoutesProvider(api_key=settings.google_maps_api_key)
    return MockRoutesProvider(avg_speed_kmh=settings.routing_avg_speed_kmh)
