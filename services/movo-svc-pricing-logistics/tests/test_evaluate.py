import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.services.routes_provider import RoutesProviderError
from main import app

client = TestClient(app)

CORDOBA = {"lat": -31.4201, "lng": -64.1888}
VILLA_MARIA = {"lat": -32.4104, "lng": -63.2404}
RIO_SEGUNDO = {"lat": -31.65, "lng": -63.91}
OLIVA = {"lat": -32.04, "lng": -63.57}

BASE_TRIP = {
    "id": "trip-test-123",
    "originLat": CORDOBA["lat"],
    "originLng": CORDOBA["lng"],
    "destinationLat": VILLA_MARIA["lat"],
    "destinationLng": VILLA_MARIA["lng"],
    "departureAt": "2026-09-12T10:00:00Z",
}


def test_evaluate_candidates_empty_list() -> None:
    payload = {
        "trip": BASE_TRIP,
        "candidates": [],
    }
    response = client.post("/routes/evaluate-candidates", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["directDistanceKm"] > 0
    assert data["directDurationMinutes"] > 0
    assert data["evaluations"] == []
    assert data["calculationMethod"] == "haversine_vrptw_v1"


def test_evaluate_candidates_single_feasible_candidate() -> None:
    candidate = {
        "id": "cand-01",
        "pickupLat": RIO_SEGUNDO["lat"],
        "pickupLng": RIO_SEGUNDO["lng"],
        "dropoffLat": OLIVA["lat"],
        "dropoffLng": OLIVA["lng"],
        "pickupWindowStart": "2026-09-12T10:30:00Z",
        "pickupWindowEnd": "2026-09-12T11:30:00Z",
        "dropoffWindowStart": "2026-09-12T11:45:00Z",
        "dropoffWindowEnd": "2026-09-12T13:00:00Z",
    }
    payload = {
        "trip": BASE_TRIP,
        "candidates": [candidate],
    }
    response = client.post("/routes/evaluate-candidates", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["evaluations"]) == 1
    ev = data["evaluations"][0]
    assert ev["candidateId"] == "cand-01"
    assert ev["feasible"] is True
    assert ev["detourDistanceKm"] >= 0
    assert ev["detourDurationMinutes"] >= 0
    assert ev["totalDistanceKm"] >= data["directDistanceKm"]
    assert ev["totalDurationMinutes"] >= data["directDurationMinutes"]


def test_evaluate_candidates_infeasible_time_window() -> None:
    # Ventana que expiró 5 horas antes de la partida del viaje (incluso con slack de 2hs no entra)
    candidate = {
        "id": "cand-late",
        "pickupLat": RIO_SEGUNDO["lat"],
        "pickupLng": RIO_SEGUNDO["lng"],
        "dropoffLat": OLIVA["lat"],
        "dropoffLng": OLIVA["lng"],
        "pickupWindowStart": "2026-09-12T04:00:00Z",
        "pickupWindowEnd": "2026-09-12T05:00:00Z",
    }
    payload = {
        "trip": BASE_TRIP,
        "candidates": [candidate],
    }
    response = client.post("/routes/evaluate-candidates", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["evaluations"]) == 1
    ev = data["evaluations"][0]
    assert ev["candidateId"] == "cand-late"
    assert ev["feasible"] is False
    assert ev["detourDistanceKm"] is None


def test_evaluate_candidates_cache_hit_and_miss() -> None:
    candidate = {
        "id": "cand-cached",
        "pickupLat": RIO_SEGUNDO["lat"],
        "pickupLng": RIO_SEGUNDO["lng"],
        "dropoffLat": OLIVA["lat"],
        "dropoffLng": OLIVA["lng"],
    }
    payload = {
        "trip": BASE_TRIP,
        "candidates": [candidate],
    }

    mock_redis = AsyncMock()
    # 1. Cache Miss: redis.get devuelve None -> calcula y llama a redis.set
    mock_redis.get.return_value = None

    with patch("app.services.candidate_evaluator.get_redis_client", return_value=mock_redis):
        response1 = client.post("/routes/evaluate-candidates", json=payload)
        assert response1.status_code == 200
        data1 = response1.json()
        assert data1["evaluations"][0]["feasible"] is True
        mock_redis.set.assert_awaited_once()
        cache_key = f"route_solution:{BASE_TRIP['id']}:cand-cached"
        assert mock_redis.set.call_args[0][0] == cache_key

    # 2. Cache Hit: redis.get devuelve la solución previa
    cached_solution = {
        "tripId": BASE_TRIP["id"],
        "candidateId": "cand-cached",
        "feasible": True,
        "detourDistanceKm": 7.5,
        "detourDurationMinutes": 12,
        "totalDistanceKm": 150.0,
        "totalDurationMinutes": 120,
    }
    mock_redis.get.return_value = json.dumps(cached_solution)

    with (
        patch("app.services.candidate_evaluator.get_redis_client", return_value=mock_redis),
        patch("app.services.candidate_evaluator.CandidateEvaluator._solve_candidate") as mock_solver,
    ):
        response2 = client.post("/routes/evaluate-candidates", json=payload)
        assert response2.status_code == 200
        data2 = response2.json()
        ev2 = data2["evaluations"][0]
        assert ev2["feasible"] is True
        assert ev2["detourDistanceKm"] == 7.5
        assert ev2["detourDurationMinutes"] == 12
        # El solver de OR-Tools no debe haber sido llamado porque se sirvió de cache
        mock_solver.assert_not_called()


def test_evaluate_candidates_max_limit_validation() -> None:
    # Más de 25 candidatos debe disparar 422 de Pydantic
    candidates = [
        {
            "id": f"cand-{i}",
            "pickupLat": RIO_SEGUNDO["lat"],
            "pickupLng": RIO_SEGUNDO["lng"],
            "dropoffLat": OLIVA["lat"],
            "dropoffLng": OLIVA["lng"],
        }
        for i in range(26)
    ]
    payload = {
        "trip": BASE_TRIP,
        "candidates": candidates,
    }
    response = client.post("/routes/evaluate-candidates", json=payload)
    assert response.status_code == 422


def test_evaluate_candidates_routes_provider_error_raises_502() -> None:
    candidate = {
        "id": "cand-err",
        "pickupLat": RIO_SEGUNDO["lat"],
        "pickupLng": RIO_SEGUNDO["lng"],
        "dropoffLat": OLIVA["lat"],
        "dropoffLng": OLIVA["lng"],
    }
    payload = {
        "trip": BASE_TRIP,
        "candidates": [candidate],
    }

    with patch(
        "app.services.routes_provider.MockRoutesProvider.compute_matrix",
        side_effect=RoutesProviderError("Google Routes API falló", status_code=502),
    ):
        response = client.post("/routes/evaluate-candidates", json=payload)
        assert response.status_code == 502
        assert "Google Routes API falló" in response.json()["detail"]
