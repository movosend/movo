from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

# Coordenadas elegidas para que solo varíe la latitud -- así `distanceKm` da
# exactamente `dlat * 111.32` sin depender de `cos(latitud promedio)`, y las cuentas
# a mano (DoD del ticket) quedan verificables sin una calculadora científica.


def test_quote_standard_package_no_factor() -> None:
    response = client.post(
        "/quote",
        json={
            "originLat": 0,
            "originLng": 0,
            "destinationLat": 1,
            "destinationLng": 0,
            "weightKg": 10,
            "lengthCm": 20,
            "widthCm": 15,
            "heightCm": 10,
            "packageType": "standard_package",
            "urgent": False,
        },
    )

    assert response.status_code == 200
    body = response.json()

    # distanceKm = 1 * 111.32 = 111.32
    # base=1500 + distancia(111.32*150=16698) + peso(10*300=3000) = 21198
    # factor standard_package = 1.0 -> sin cambios
    assert body["suggestedPriceArs"] == 21198.0
    assert body["calculationMethod"] == "euclidean_linear_v1"
    assert body["highDemand"] is False
    assert "breakdown" not in body


def test_quote_fragile_item_applies_factor() -> None:
    response = client.post(
        "/quote",
        json={
            "originLat": 0,
            "originLng": 0,
            "destinationLat": 2,
            "destinationLng": 0,
            "weightKg": 5,
            "lengthCm": 20,
            "widthCm": 15,
            "heightCm": 10,
            "packageType": "fragile_item",
            "urgent": False,
        },
    )

    assert response.status_code == 200
    body = response.json()

    # distanceKm = 2 * 111.32 = 222.64
    # subtotal = 1500 + (222.64*150=33396) + (5*300=1500) = 36396
    # factor fragile_item = 1.2 -> 36396 * 1.2 = 43675.2
    assert body["suggestedPriceArs"] == 43675.2
    assert body["calculationMethod"] == "euclidean_linear_v1"
    assert body["highDemand"] is False


def test_quote_letter_document() -> None:
    response = client.post(
        "/quote",
        json={
            "originLat": 0,
            "originLng": 0,
            "destinationLat": 0.5,
            "destinationLng": 0,
            "weightKg": 1,
            "lengthCm": 30,
            "widthCm": 22,
            "heightCm": 2,
            "packageType": "letter_document",
            "urgent": True,
        },
    )

    assert response.status_code == 200
    body = response.json()

    # distanceKm = 0.5 * 111.32 = 55.66
    # subtotal = 1500 + (55.66*150=8349) + (1*300=300) = 10149, factor 1.0
    assert body["suggestedPriceArs"] == 10149.0


def test_quote_missing_field_returns_422() -> None:
    response = client.post(
        "/quote",
        json={
            "originLat": 0,
            "originLng": 0,
            "destinationLat": 1,
            "destinationLng": 0,
            # weightKg faltante a propósito
            "lengthCm": 20,
            "widthCm": 15,
            "heightCm": 10,
            "packageType": "standard_package",
            "urgent": False,
        },
    )

    assert response.status_code == 422


def test_quote_accepts_demand_context() -> None:
    response = client.post(
        "/quote",
        json={
            "originLat": 0,
            "originLng": 0,
            "destinationLat": 1,
            "destinationLng": 0,
            "weightKg": 10,
            "lengthCm": 20,
            "widthCm": 15,
            "heightCm": 10,
            "packageType": "standard_package",
            "urgent": False,
            "demandContext": {"publishedShipments": 9, "availableCarriers": 2},
        },
    )

    assert response.status_code == 200


def test_quote_negative_demand_context_returns_422() -> None:
    response = client.post(
        "/quote",
        json={
            "originLat": 0,
            "originLng": 0,
            "destinationLat": 1,
            "destinationLng": 0,
            "weightKg": 10,
            "lengthCm": 20,
            "widthCm": 15,
            "heightCm": 10,
            "packageType": "standard_package",
            "urgent": False,
            "demandContext": {"publishedShipments": -1, "availableCarriers": 2},
        },
    )

    assert response.status_code == 422
