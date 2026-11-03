from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.models.optimize import Coordinates
from app.services.routes_provider import GoogleRoutesProvider, RoutesProviderError
from app.services.vrptw_solver import _parse_time_window
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def force_mock_routes_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "routes_provider", "mock")


def test_optimize_empty_stops() -> None:
    """AC1 / Edge case: Si el transportista no tiene envíos activos, retorna ruta vacía (200)."""
    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": -31.4167, "lng": -64.1833},
            "stops": [],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["stops"] == []
    assert data["totalDistanceKm"] == 0.0
    assert data["totalDurationMinutes"] == 0.0
    assert data["status"] == "EMPTY"
    assert data["disclaimer"] == "Ruta sin paradas asignadas."



def test_optimize_single_shipment_precedence() -> None:
    """AC2 / AC5: Con un solo envío activo (pickup + delivery), se garantiza precedencia."""
    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": -31.4167, "lng": -64.1833},
            "departureTime": "2026-09-10T08:00:00Z",
            "stops": [
                {
                    "shipmentId": "shipment-1",
                    "type": "delivery",
                    "lat": -31.9139,
                    "lng": -63.6817,
                    "address": "Oncativo",
                    "timeWindowStart": "2026-09-10T09:00:00Z",
                    "timeWindowEnd": "2026-09-10T12:00:00Z",
                },
                {
                    "shipmentId": "shipment-1",
                    "type": "pickup",
                    "lat": -31.4250,
                    "lng": -64.1870,
                    "address": "Nueva Córdoba",
                    "timeWindowStart": "2026-09-10T08:15:00Z",
                    "timeWindowEnd": "2026-09-10T09:30:00Z",
                },
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["stops"]) == 2

    # El pickup SIEMPRE debe ser el primero, aunque en el input vino segundo
    assert data["stops"][0]["type"] == "pickup"
    assert data["stops"][0]["shipmentId"] == "shipment-1"
    assert data["stops"][0]["stopOrder"] == 0

    assert data["stops"][1]["type"] == "delivery"
    assert data["stops"][1]["shipmentId"] == "shipment-1"
    assert data["stops"][1]["stopOrder"] == 1

    assert data["totalDistanceKm"] > 0
    assert data["totalDurationMinutes"] > 0
    assert data["calculationMethod"] == "haversine_vrptw_v1"
    assert "ADR-013" in data["disclaimer"]


def test_optimize_multi_shipment_precedence() -> None:
    """AC2: Multi-envío con 3 envíos simultáneos (6 paradas).

    Para cada uno de los 3 envíos, el retiro debe anteceder estrictamente a su entrega.
    """
    stops_input = [
        # Envío 1: Córdoba -> Oncativo
        {
            "shipmentId": "ship-1",
            "type": "pickup",
            "lat": -31.4250,
            "lng": -64.1870,
            "address": "Córdoba Centro",
        },
        {
            "shipmentId": "ship-1",
            "type": "delivery",
            "lat": -31.9139,
            "lng": -63.6817,
            "address": "Oncativo",
        },
        # Envío 2: Córdoba -> Oliva
        {
            "shipmentId": "ship-2",
            "type": "pickup",
            "lat": -31.4300,
            "lng": -64.1900,
            "address": "Córdoba Sur",
        },
        {
            "shipmentId": "ship-2",
            "type": "delivery",
            "lat": -32.0416,
            "lng": -63.5698,
            "address": "Oliva",
        },
        # Envío 3: Oliva -> Villa María
        {
            "shipmentId": "ship-3",
            "type": "pickup",
            "lat": -32.0450,
            "lng": -63.5700,
            "address": "Oliva Terminal",
        },
        {
            "shipmentId": "ship-3",
            "type": "delivery",
            "lat": -32.4075,
            "lng": -63.2403,
            "address": "Villa María",
        },
    ]

    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": -31.4167, "lng": -64.1833},
            "departureTime": "2026-09-10T08:00:00Z",
            "stops": stops_input,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["stops"]) == 6

    # Mapear índices de cada parada por shipment y tipo
    order_map: dict[str, dict[str, int]] = {}
    for idx, stop in enumerate(data["stops"]):
        s_id = stop["shipmentId"]
        s_type = stop["type"]
        if s_id not in order_map:
            order_map[s_id] = {}
        order_map[s_id][s_type] = idx

    # Verificar precedencia estricta para los 3 envíos
    for s_id in ["ship-1", "ship-2", "ship-3"]:
        pickup_order = order_map[s_id]["pickup"]
        delivery_order = order_map[s_id]["delivery"]
        assert pickup_order < delivery_order, (
            f"Precedencia violada para {s_id}: pickup={pickup_order}, delivery={delivery_order}"
        )


def test_optimize_in_transit_shipment_only_delivery() -> None:
    """Envío en estado in_transit: solo aporta entrega porque ya fue retirado."""
    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": -31.4167, "lng": -64.1833},
            "stops": [
                # Envío ya retirado
                {
                    "shipmentId": "ship-in-transit",
                    "type": "delivery",
                    "lat": -31.9139,
                    "lng": -63.6817,
                    "address": "Oncativo",
                },
                # Envío nuevo
                {
                    "shipmentId": "ship-new",
                    "type": "pickup",
                    "lat": -31.4250,
                    "lng": -64.1870,
                    "address": "Córdoba",
                },
                {
                    "shipmentId": "ship-new",
                    "type": "delivery",
                    "lat": -32.0416,
                    "lng": -63.5698,
                    "address": "Oliva",
                },
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["stops"]) == 3

    # Para ship-new, pickup debe preceder a delivery
    new_pickup_idx = next(
        i for i, s in enumerate(data["stops"]) if s["shipmentId"] == "ship-new" and s["type"] == "pickup"
    )
    new_delivery_idx = next(
        i for i, s in enumerate(data["stops"]) if s["shipmentId"] == "ship-new" and s["type"] == "delivery"
    )
    assert new_pickup_idx < new_delivery_idx


def test_optimize_outside_time_window_reporting() -> None:
    """AC3: Si una parada no llega dentro de la ventana, marca outsideTimeWindow: true en vez de 500."""
    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": -31.4167, "lng": -64.1833},
            "departureTime": "2026-09-10T08:00:00Z",
            "stops": [
                {
                    "shipmentId": "shipment-late",
                    "type": "pickup",
                    "lat": -31.4250,
                    "lng": -64.1870,
                    # Ventana ya vencida respecto a la salida
                    "timeWindowStart": "2026-09-10T08:01:00Z",
                    "timeWindowEnd": "2026-09-10T08:02:00Z",
                },
                {
                    "shipmentId": "shipment-late",
                    "type": "delivery",
                    "lat": -31.9139,
                    "lng": -63.6817,
                    "timeWindowStart": "2026-09-10T08:05:00Z",
                    "timeWindowEnd": "2026-09-10T08:10:00Z",
                },
            ],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["stops"]) == 2

    # A Oncativo (delivery a ~75km) es imposible llegar a las 08:10 saliendo a las 08:00 a 40km/h
    delivery_stop = next(s for s in data["stops"] if s["type"] == "delivery")
    assert delivery_stop["outsideTimeWindow"] is True


def test_google_routes_provider_canonical_order_and_matrix() -> None:
    """Verifica que GoogleRoutesProvider envíe waypoints en orden canónico y procese la respuesta."""
    provider = GoogleRoutesProvider(api_key="test-api-key")

    mock_response_data = [
        {"originIndex": 0, "destinationIndex": 0, "distanceMeters": 0, "duration": "0s"},
        {"originIndex": 0, "destinationIndex": 1, "distanceMeters": 15000, "duration": "1200s"},
        {"originIndex": 1, "destinationIndex": 0, "distanceMeters": 15000, "duration": "1200s"},
        {"originIndex": 1, "destinationIndex": 1, "distanceMeters": 0, "duration": "0s"},
    ]

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = mock_response_data

    with patch("httpx.Client.post", return_value=mock_resp) as mock_post:
        waypoints = [
            Coordinates(lat=-31.4167, lng=-64.1833),
            Coordinates(lat=-31.4250, lng=-64.1870),
        ]
        res = provider.compute_matrix(waypoints)

        # Verificar headers y field mask
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["headers"]["X-Goog-Api-Key"] == "test-api-key"
        assert "originIndex,destinationIndex" in kwargs["headers"]["X-Goog-FieldMask"]

        # Verificar matrices resultantes (15000m -> 15.0km, 1200s -> 20 min)
        assert res.dist_matrix_km[0][1] == 15.0
        assert res.time_matrix_min[0][1] == 20
        assert res.provider_name == "google_routes"


def test_google_routes_provider_error_raises_routes_provider_error() -> None:
    """Política No-Fallback: Si Google Routes API falla, lanza RoutesProviderError (HTTP 502)."""
    provider = GoogleRoutesProvider(api_key="test-api-key")

    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "Internal Google Error"

    with patch("httpx.Client.post", return_value=mock_resp):
        waypoints = [
            Coordinates(lat=-31.4167, lng=-64.1833),
            Coordinates(lat=-31.4250, lng=-64.1870),
        ]
        try:
            provider.compute_matrix(waypoints)
            assert False, "Debería haber lanzado RoutesProviderError"
        except RoutesProviderError as exc:
            assert exc.status_code == 502
            assert "Google Routes API devolvió un error" in str(exc)


def test_optimize_validation_error_invalid_coordinates() -> None:
    """Valida que coordenadas fuera de rango retornen 422 con formato estándar."""
    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": 150.0, "lng": -64.1833},  # lat > 90 es inválida
            "stops": [],
        },
    )
    assert response.status_code == 422


def _single_delivery(window_start: str | None = None, window_end: str | None = None) -> dict[str, object]:
    stop: dict[str, object] = {
        "shipmentId": "ship-tz",
        "type": "delivery",
        "lat": -31.4250,
        "lng": -64.1870,
    }
    if window_start is not None:
        stop["timeWindowStart"] = window_start
    if window_end is not None:
        stop["timeWindowEnd"] = window_end
    return stop


def test_optimize_without_departure_time_returns_offset() -> None:
    """MOVO-346 (punto 15): sin departureTime, las horas salen con offset, no como hora local ambigua."""
    response = client.post(
        "/optimize/route",
        json={"carrierLocation": {"lat": -31.4167, "lng": -64.1833}, "stops": [_single_delivery()]},
    )
    assert response.status_code == 200
    stop = response.json()["stops"][0]
    for key in ("estimatedArrivalAt", "estimatedDepartureAt"):
        parsed = datetime.fromisoformat(stop[key])
        assert parsed.utcoffset() == timedelta(0)


def test_optimize_arrival_is_departure_plus_minutes() -> None:
    """MOVO-346 (punto 15): con departureTime en UTC, la llegada es la salida más los minutos, en UTC."""
    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": -31.4167, "lng": -64.1833},
            "departureTime": "2026-10-25T21:55:00Z",
            "stops": [_single_delivery()],
        },
    )
    assert response.status_code == 200
    stop = response.json()["stops"][0]
    arrival = datetime.fromisoformat(stop["estimatedArrivalAt"])
    expected = datetime(2026, 10, 25, 21, 55, tzinfo=timezone.utc) + timedelta(
        minutes=stop["estimatedArrivalMinutes"]
    )
    assert arrival == expected


def test_optimize_naive_departure_time_is_utc() -> None:
    """MOVO-346: una departureTime sin offset se toma como UTC, no con la TZ del contenedor."""
    response = client.post(
        "/optimize/route",
        json={
            "carrierLocation": {"lat": -31.4167, "lng": -64.1833},
            "departureTime": "2026-10-25T21:55:00",
            "stops": [_single_delivery()],
        },
    )
    assert response.status_code == 200
    arrival = datetime.fromisoformat(response.json()["stops"][0]["estimatedArrivalAt"])
    assert arrival.utcoffset() == timedelta(0)
    assert arrival >= datetime(2026, 10, 25, 21, 55, tzinfo=timezone.utc)


def test_parse_time_window_clock_time_is_argentina() -> None:
    """MOVO-346: una ventana "HH:MM" es hora de reloj de Argentina (UTC-3)."""
    base = datetime(2026, 10, 25, 21, 0, tzinfo=timezone.utc)  # 18:00 ART
    minutes, raw = _parse_time_window("19:00", base)
    assert minutes == 60
    assert raw == "19:00"


def test_parse_time_window_naive_iso_is_utc() -> None:
    base = datetime(2026, 10, 25, 21, 0, tzinfo=timezone.utc)
    minutes, _ = _parse_time_window("2026-10-25T22:30:00", base)
    assert minutes == 90
