import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { AvailableShipment } from "../src/api/shipments-client";
import { AvailableShipmentCard } from "../components/transport/available-shipment-card";
import { formatTripDistanceKm, haversineDistanceKm } from "../src/lib/shipment-format";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

function availableShipment(overrides: Partial<AvailableShipment> = {}): AvailableShipment {
  return {
    id: "available-1",
    packageType: "standard_package",
    weightKg: 3,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-09-10",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    calculationMethod: "euclidean_linear_v1",
    status: ShipmentStatus.PUBLISHED,
    pickupDistanceKm: 3.2,
    deliveryDistanceKm: null,
    distanceKm: 3.2,
    hasMyOffer: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("AvailableShipmentCard", () => {
  afterEach(() => jest.clearAllMocks());

  it("tocarla navega al detalle del transportista, no al de mis envíos", async () => {
    const { getByTestId } = await render(<AvailableShipmentCard shipment={availableShipment()} testID="card" />);

    await fireEvent.press(getByTestId("card"));

    expect(mockRouterPush).toHaveBeenCalledWith("/transport/available-1");
  });

  it("MOVO-163: con interactive={false} (TripMatchAlertBanner), tocarla no navega", async () => {
    const { getByTestId } = await render(
      <AvailableShipmentCard shipment={availableShipment()} interactive={false} testID="card" />,
    );

    await fireEvent.press(getByTestId("card"));

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("muestra la distancia total del viaje en línea recta (Haversine)", async () => {
    const pickup = { lat: -31.4201, lng: -64.1888 };
    const delivery = { lat: -31.4241, lng: -64.4978 }; // Córdoba a Villa Carlos Paz
    const expectedLabel = formatTripDistanceKm(
      haversineDistanceKm(pickup.lat, pickup.lng, delivery.lat, delivery.lng),
    );

    const { getByTestId } = await render(
      <AvailableShipmentCard
        shipment={availableShipment({
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          deliveryLat: delivery.lat,
          deliveryLng: delivery.lng,
        })}
        testID="card"
      />,
    );

    expect(getByTestId("card-trip-distance").props.children.join("")).toBe(`${expectedLabel} de viaje`);
  });

  it("no muestra la marca de urgente por defecto", async () => {
    const { queryByTestId } = await render(<AvailableShipmentCard shipment={availableShipment()} testID="card" />);

    expect(queryByTestId("card-urgent")).toBeNull();
    expect(queryByTestId("card-has-offer")).toBeNull();
  });

  it("marca envíos urgentes y donde ya hay una oferta propia", async () => {
    const { getByTestId } = await render(
      <AvailableShipmentCard shipment={availableShipment({ urgent: true, hasMyOffer: true })} testID="card" />,
    );

    expect(getByTestId("card-urgent")).toBeTruthy();
    expect(getByTestId("card-has-offer")).toBeTruthy();
  });
});
