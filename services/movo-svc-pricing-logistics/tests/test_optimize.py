from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.models.optimize import Coordinates
from app.services.routes_provider import GoogleRoutesProvider, RoutesProviderError
from main import app

client = TestClient(app)


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
