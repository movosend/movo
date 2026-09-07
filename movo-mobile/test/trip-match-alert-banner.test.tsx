import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { AvailableShipment } from "../src/api/shipments-client";

let mockPathname = "/(tabs)/home";
jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
}));

const mockUseActiveTripMatchAlert = jest.fn();
jest.mock("../src/hooks/use-active-trip-match-alert", () => ({
  useActiveTripMatchAlert: () => mockUseActiveTripMatchAlert(),
}));

import { TripMatchAlertBanner } from "../components/trips/trip-match-alert-banner";

function shipment(overrides: Partial<AvailableShipment> = {}): AvailableShipment {
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

describe("TripMatchAlertBanner (MOVO-163)", () => {
  beforeEach(() => {
    mockPathname = "/(tabs)/home";
  });
  afterEach(() => jest.clearAllMocks());

  it("no renderiza nada sin una alerta activa", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({ alert: null, dismiss: jest.fn() });

    const { queryByTestId } = await render(<TripMatchAlertBanner />);

    expect(queryByTestId("trip-match-alert-carousel")).toBeNull();
  });

  it("muestra el mensaje en singular con un solo match pendiente, sin contador", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment()] },
      dismiss: jest.fn(),
    });

    const { getByText, queryByTestId } = await render(<TripMatchAlertBanner />);

    expect(getByText("1 paquete compatible con tu viaje")).toBeTruthy();
    expect(queryByTestId("trip-match-alert-counter")).toBeNull();
  });

  it("muestra el mensaje en plural y el contador 1/N con más de un match pendiente", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment({ id: "a" }), shipment({ id: "b" }), shipment({ id: "c" })] },
      dismiss: jest.fn(),
    });

    const { getByText, getByTestId } = await render(<TripMatchAlertBanner />);

    expect(getByText("3 paquetes compatibles con tu viaje")).toBeTruthy();
    expect(getByTestId("trip-match-alert-counter")).toHaveTextContent("1/3");
  });

  it("sin puntos de página con un solo match pendiente", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment()] },
      dismiss: jest.fn(),
    });

    const { queryByTestId } = await render(<TripMatchAlertBanner />);

    expect(queryByTestId("trip-match-alert-dots")).toBeNull();
  });

  it("muestra un punto de página por match, marcando el índice actual (0 al abrir)", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment({ id: "a" }), shipment({ id: "b" }), shipment({ id: "c" })] },
      dismiss: jest.fn(),
    });

    const { getByTestId } = await render(<TripMatchAlertBanner />);

    expect(getByTestId("trip-match-alert-dot-0")).toBeTruthy();
    expect(getByTestId("trip-match-alert-dot-1")).toBeTruthy();
    expect(getByTestId("trip-match-alert-dot-2")).toBeTruthy();
  });

  it("el carrusel muestra una AvailableShipmentCard reusada por cada match pendiente", async () => {
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment({ id: "a" }), shipment({ id: "b" })] },
      dismiss: jest.fn(),
    });

    const { getByTestId } = await render(<TripMatchAlertBanner />);

    expect(getByTestId("trip-match-alert-shipment-card-a")).toBeTruthy();
    expect(getByTestId("trip-match-alert-shipment-card-b")).toBeTruthy();
  });

  it("tocar la X descarta la alerta", async () => {
    const dismiss = jest.fn();
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment()] },
      dismiss,
    });

    const { getByTestId } = await render(<TripMatchAlertBanner />);
    fireEvent.press(getByTestId("trip-match-alert-dismiss"));

    expect(dismiss).toHaveBeenCalled();
  });

  it("tocar el backdrop descarta la alerta (mismo criterio que el resto de los sheets del repo)", async () => {
    const dismiss = jest.fn();
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment()] },
      dismiss,
    });

    const { getByTestId } = await render(<TripMatchAlertBanner />);
    fireEvent.press(getByTestId("trip-match-alert-backdrop"));

    expect(dismiss).toHaveBeenCalled();
  });

  it("se oculta mientras se está viendo el detalle de un envío (/transport/:id), sin descartar la alerta", async () => {
    mockPathname = "/transport/available-1";
    mockUseActiveTripMatchAlert.mockReturnValue({
      alert: { tripId: "trip-1", shipments: [shipment()] },
      dismiss: jest.fn(),
    });

    const { queryByTestId } = await render(<TripMatchAlertBanner />);

    expect(queryByTestId("trip-match-alert-carousel")).toBeNull();
  });
});
