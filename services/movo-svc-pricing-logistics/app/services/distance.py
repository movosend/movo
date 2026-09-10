import math
from typing import Sequence

from app.models.optimize import Coordinates, RouteStopInput

# Radio medio de la Tierra en kilómetros
EARTH_RADIUS_KM = 6371.0


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calcula la distancia geodésica del círculo máximo entre dos puntos en km (Haversine).

    ADR-013 / MOVO-50: mock para desarrollo y testing sin costo de Google Routes API.
    """
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(EARTH_RADIUS_KM * c, 3)


def haversine_travel_time_minutes(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
    avg_speed_kmh: float = 40.0,
) -> int:
    """Estima el tiempo de traslado en minutos asumiendo una velocidad promedio en km/h.

    Redondea hacia arriba (techo) para contemplar márgenes de detención.
    """
    dist_km = haversine_distance_km(lat1, lon1, lat2, lon2)
    if dist_km <= 0.0 or avg_speed_kmh <= 0.0:
        return 0
    hours = dist_km / avg_speed_kmh
    return math.ceil(hours * 60.0)


def point_to_segment_distance_km(
    p_lat: float,
    p_lon: float,
    a_lat: float,
    a_lon: float,
    b_lat: float,
    b_lon: float,
) -> float:
    """Calcula la distancia ortogonal/mínima desde el punto P al segmento recto AB en kilómetros.

    Utiliza proyección equirectangular centrada en el punto medio del segmento
    (AC6 de MOVO-50 / AC8 de MOVO-205).
    """
    mid_lat_rad = math.radians((a_lat + b_lat) / 2.0)
    kx = 111.32 * math.cos(mid_lat_rad)  # km por grado de longitud
    ky = 110.574  # km por grado de latitud

    ax, ay = 0.0, 0.0
    bx = (b_lon - a_lon) * kx
    by = (b_lat - a_lat) * ky
    px = (p_lon - a_lon) * kx
    py = (p_lat - a_lat) * ky

    ab_x, ab_y = bx - ax, by - ay
    ap_x, ap_y = px - ax, py - ay

    ab2 = ab_x**2 + ab_y**2
    if ab2 == 0:
        return math.hypot(px, py)

    t = (ap_x * ab_x + ap_y * ab_y) / ab2
    t = max(0.0, min(1.0, t))

    qx = ax + t * ab_x
    qy = ay + t * ab_y

    return round(math.hypot(px - qx, py - qy), 3)


def filter_stops_by_corridor(
    stops: Sequence[RouteStopInput],
    origin: Coordinates,
    destination: Coordinates,
    max_deviation_km: float = 15.0,
) -> tuple[list[RouteStopInput], list[RouteStopInput]]:
    """Filtra paradas que se desvíen más de max_deviation_km del corredor origen-destino.

    Retorna (paradas_admitidas, paradas_descartadas).
    """
    passed: list[RouteStopInput] = []
    rejected: list[RouteStopInput] = []

    for stop in stops:
        dev_km = point_to_segment_distance_km(
            stop.lat, stop.lng, origin.lat, origin.lng, destination.lat, destination.lng
        )
        if dev_km <= max_deviation_km:
            passed.append(stop)
        else:
            rejected.append(stop)

    return passed, rejected
