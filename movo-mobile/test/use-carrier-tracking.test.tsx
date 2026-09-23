import { renderHook, act } from "@testing-library/react-native";
import * as Location from "expo-location";
import { type ActiveShipmentSummary } from "../src/api/shipments-client";
import { useCarrierTracking } from "../src/hooks/use-carrier-tracking";
import { locationService } from "../src/location/location-service";

const mockUseQuery = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 1 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: {
    getTransporting: jest.fn(),
    reportPosition: jest.fn(),
  },
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (state: { status: string; user: { userId: string } }) => unknown) =>
    selector({ status: "authenticated", user: { userId: "carrier-1" } }),
}));

function activeShipment(id: string, status: "assigned_unfunded" | "assigned" | "in_transit"): ActiveShipmentSummary {
  return {
    id,
    status,
    pickupDate: "2026-09-23",
    pickupTimeWindowStart: "10:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Origen 100",
    deliveryAddress: "Destino 200",
    agreedPriceArs: 4000,
    counterparty: { name: "Juan", initials: "J" },
    isToday: true,
    pickupWindowExpired: false,
  };
}

describe("useCarrierTracking hook (MOVO-203)", () => {
  beforeEach(() => {
    jest.spyOn(locationService, "updateActiveShipments").mockResolvedValue(undefined);
    jest.spyOn(locationService, "stopTracking").mockResolvedValue(undefined);
    jest.spyOn(locationService, "subscribe").mockReturnValue(() => {});

    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: "granted",
    });
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: "granted",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("activa el tracking cuando hay envíos en estado in_transit (AC1)", async () => {
    mockUseQuery.mockReturnValue({
      data: [
        activeShipment("ship-1", "in_transit"),
        activeShipment("ship-2", "assigned"),
      ],
      refetch: jest.fn(),
    });

    const { result } = await renderHook(() => useCarrierTracking());

    expect(result.current.inTransitCount).toBe(1);
    expect(result.current.inTransitShipments[0].id).toBe("ship-1");
    expect(locationService.updateActiveShipments).toHaveBeenCalledWith(["ship-1"]);
  });

  it("detiene el tracking si no hay ningún envío en in_transit (AC5, AC7)", async () => {
    mockUseQuery.mockReturnValue({
      data: [activeShipment("ship-2", "assigned")],
      refetch: jest.fn(),
    });

    const { result } = await renderHook(() => useCarrierTracking());

    expect(result.current.inTransitCount).toBe(0);
    expect(locationService.updateActiveShipments).toHaveBeenCalledWith([]);
  });

  it("permite solicitar permisos de ubicación en primer plano", async () => {
    mockUseQuery.mockReturnValue({
      data: [],
      refetch: jest.fn(),
    });

    const { result } = await renderHook(() => useCarrierTracking());

    let granted = false;
    await act(async () => {
      granted = await result.current.requestPermission();
    });

    expect(granted).toBe(true);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
    expect(result.current.permissionGranted).toBe(true);
  });
});
