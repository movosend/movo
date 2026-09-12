import math

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

