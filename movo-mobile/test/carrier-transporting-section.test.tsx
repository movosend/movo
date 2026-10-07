import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import { CarrierTransportingSection } from "../components/home/carrier-transporting-section";
import { TripStatus } from "../src/api/trips-client";
import { ApiError } from "@movo/shared/dist/errors/api-error";

// El gate de ubicación del transportista tiene su propio test
// (carrier-location-gate.test.tsx): acá se asume que ya cumple los requisitos.
jest.mock("../src/store/carrier-location-gate-store", () => ({
  requireCarrierLocation: (action: () => unknown) => action(),
}));

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

const mockUseMyTrips = jest.fn();
const mockStartTripMutateAsync = jest.fn();
const mockUseTransportingShipments = jest.fn();

jest.mock("../src/hooks/use-trips", () => ({
  useMyTrips: () => mockUseMyTrips(),
  useStartTrip: () => ({
    mutateAsync: mockStartTripMutateAsync,
    isPending: false,
  }),
}));

jest.mock("../src/hooks/use-active-shipments", () => ({
  useTransportingShipments: () => mockUseTransportingShipments(),
}));

describe("CarrierTransportingSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseTransportingShipments.mockReturnValue({ data: [] });
  });

  it("retorna null si no hay viajes o ninguno tiene paquetes aceptados", async () => {
    mockUseMyTrips.mockReturnValue({
      data: {
        items: [
          {
            id: "t1",
            status: TripStatus.DECLARED,
            hasAcceptedPackages: false,
            departureAt: new Date().toISOString(),
          },
        ],
        total: 1,
      },
    });

    const { queryByTestId } = await render(<CarrierTransportingSection />);
    expect(queryByTestId("app-home-transporting")).toBeNull();
  });

  it("renderiza la sección y card con botón 'Iniciar viaje' para viaje declared con paquetes", async () => {
    const today = new Date().toISOString();
    mockUseMyTrips.mockReturnValue({
      data: {
        items: [
          {
            id: "t-ready",
            carrierId: "c1",
            originAddress: "Av. Colón 100, Córdoba",
            destinationAddress: "San Martín 200, Villa Carlos Paz",
            departureAt: today,
            status: TripStatus.DECLARED,
            hasAcceptedPackages: true,
          },
        ],
        total: 1,
      },
    });

    const { getByTestId, getByText } = await render(<CarrierTransportingSection />);

    expect(getByTestId("app-home-transporting")).toBeTruthy();
    expect(getByText(/estoy transportando/i)).toBeTruthy();
    expect(getByText("1")).toBeTruthy();
    expect(getByText("Hoy")).toBeTruthy();
    expect(getByText("Iniciar viaje")).toBeTruthy();

    fireEvent.press(getByText("Iniciar viaje"));
    expect(mockStartTripMutateAsync).toHaveBeenCalledWith("t-ready");
  });

  it("renderiza card para viaje activo con botón 'Viaje en curso · ver mapa'", async () => {
    mockUseMyTrips.mockReturnValue({
      data: {
        items: [
          {
            id: "t-active",
            carrierId: "c1",
            originAddress: "Av. Colón 100, Córdoba",
            destinationAddress: "San Martín 200, Villa Carlos Paz",
            departureAt: new Date().toISOString(),
            status: TripStatus.ACTIVE,
            hasAcceptedPackages: true,
          },
        ],
        total: 1,
      },
    });

    const { getByText } = await render(<CarrierTransportingSection />);

    expect(getByText("En curso")).toBeTruthy();
    const mapButton = getByText("Viaje en curso · ver mapa");
    expect(mapButton).toBeTruthy();

    fireEvent.press(mapButton);
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/route",
      params: { tripId: "t-active" },
    });
  });

  it("muestra banner de error si la mutación falla con 409", async () => {
    const today = new Date().toISOString();
    mockUseMyTrips.mockReturnValue({
      data: {
        items: [
          {
            id: "t-err",
            carrierId: "c1",
            originAddress: "Av. Colón 100, Córdoba",
            destinationAddress: "San Martín 200, Villa Carlos Paz",
            departureAt: today,
            status: TripStatus.DECLARED,
            hasAcceptedPackages: true,
          },
        ],
        total: 1,
      },
    });

    mockStartTripMutateAsync.mockRejectedValueOnce(
      new ApiError(409, "TRIP_ALREADY_HAS_ACTIVE_TRIP", "Ya tenés otro viaje en curso"),
    );

    const { getByText, findByText } = await render(<CarrierTransportingSection />);
    await act(async () => {
      fireEvent.press(getByText("Iniciar viaje"));
    });

    const errorMsg = await findByText(
      "Ya tenés otro viaje en curso. Solo podés tener 1 viaje activo a la vez.",
    );
    expect(errorMsg).toBeTruthy();
  });
});
