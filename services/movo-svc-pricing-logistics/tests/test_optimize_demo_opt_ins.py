"""Opt-ins de `/optimize/route` (`objective`, `matrix`) y `POST /routes/matrix`, que usa
el juego del optimizador de la feria (módulo demo de `movo-svc-shipments`)."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def force_mock_routes_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "routes_provider", "mock")


# Salida (0), paradas A (1) y B (2), llegada (3). A→B es más corto en km pero mucho más
# lento; B→A es al revés. Así `objective` cambia el orden elegido.
DIST_KM = [
    [0.0, 1.0, 5.0, 9.0],
    [1.0, 0.0, 1.0, 5.0],
    [5.0, 1.0, 0.0, 1.0],
    [9.0, 5.0, 1.0, 0.0],
]
TIME_MIN = [
    [0, 50, 1, 90],
    [50, 0, 50, 1],
    [1, 1, 0, 50],
    [90, 1, 50, 0],
]


def _body(**extra: object) -> dict[str, object]:
    stop = {"type": "delivery", "lat": -34.6, "lng": -58.4, "serviceTimeMinutes": 0}
    return {
        "carrierLocation": {"lat": -34.60, "lng": -58.38},
        "finalLocation": {"lat": -34.58, "lng": -58.42},
        "stops": [{**stop, "shipmentId": "a"}, {**stop, "shipmentId": "b"}],
        "matrix": {"distKm": DIST_KM, "timeMin": TIME_MIN},
        **extra,
    }


def _order(data: dict[str, object]) -> list[str]:
    stops = data["stops"]
    assert isinstance(stops, list)
    return [s["shipmentId"] for s in stops]


def test_objective_distance_minimizes_km_over_injected_matrix() -> None:
    with patch("app.services.routes_provider.MockRoutesProvider.compute_matrix") as provider:
        response = client.post("/optimize/route", json=_body(objective="distance"))
    assert response.status_code == 200
    data = response.json()
    assert _order(data) == ["a", "b"]
    assert data["totalDistanceKm"] == 3.0
    assert data["calculationMethod"] == "precomputed_matrix_vrptw_v1"
    provider.assert_not_called()


def test_default_objective_still_minimizes_time() -> None:
    response = client.post("/optimize/route", json=_body())
    assert response.status_code == 200
    data = response.json()
    assert _order(data) == ["b", "a"]
    assert data["totalDurationMinutes"] == 3.0


def test_injected_matrix_with_wrong_size_is_rejected() -> None:
    body = _body(matrix={"distKm": DIST_KM[:3], "timeMin": TIME_MIN[:3]})
    response = client.post("/optimize/route", json=body)
    assert response.status_code == 422
    assert "4x4" in response.json()["detail"]


def test_routes_matrix_returns_square_matrix_without_billing_on_mock() -> None:
    points = [{"lat": -34.6037, "lng": -58.3816}, {"lat": -34.6083, "lng": -58.3712}, {"lat": -34.5875, "lng": -58.3934}]
    response = client.post("/routes/matrix", json={"points": points})
    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "haversine_mock"
    assert data["elementsBilled"] == 0
    assert len(data["distKm"]) == 3 and all(len(r) == 3 for r in data["distKm"])
    assert data["distKm"][0][0] == 0.0 and data["distKm"][0][1] > 0


def test_routes_matrix_limits_points() -> None:
    one = {"points": [{"lat": -34.6, "lng": -58.4}]}
    many = {"points": [{"lat": -34.6, "lng": -58.4 + i / 1000} for i in range(26)]}
    assert client.post("/routes/matrix", json=one).status_code == 422
    assert client.post("/routes/matrix", json=many).status_code == 422
