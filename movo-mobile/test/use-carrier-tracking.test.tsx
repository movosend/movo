import { renderHook, act } from "@testing-library/react-native";
import * as Location from "expo-location";
import { type ActiveShipmentSummary } from "../src/api/shipments-client";
import {
  useCarrierTracking,
  useCarrierTrackingCoordinator,
} from "../src/hooks/use-carrier-tracking";
import { locationService } from "../src/location/location-service";

const mockUseQuery = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 1 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
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

describe("useCarrierTracking y coordinador (MOVO-203 / MOVO-242)", () => {
  beforeEach(() => {
    jest.spyOn(locationService, "updateActiveShipments").mockResolvedValue(undefined);
    jest.spyOn(locationService, "stopTracking").mockResolvedValue(undefined);

    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: "granted",
    });
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: "granted",
    });
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: "granted",
    });
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      status: "granted",
    });
  });

  afterEach(async () => {
    await act(async () => {
      await locationService.resetForTesting();
    });
    jest.clearAllMocks();
  });

  describe("useCarrierTrackingCoordinator", () => {
    it("activa el tracking cuando hay envíos en estado assigned o in_transit (MOVO-242, AC1)", async () => {
      mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "shipments") {
          return {
            data: [
              activeShipment("ship-1", "in_transit"),
              activeShipment("ship-2", "assigned"),
            ],
            refetch: jest.fn(),
          };
        }
        return { data: undefined, refetch: jest.fn() };
      });

      const { result } = await renderHook(() => useCarrierTrackingCoordinator());

      expect(result.current.trackableCount).toBe(2);
      expect(result.current.inTransitCount).toBe(1);
      expect(result.current.trackableShipments.map((s) => s.id)).toEqual(["ship-1", "ship-2"]);
      expect(locationService.updateActiveShipments).toHaveBeenCalledWith(["ship-1", "ship-2"], null, null);
    });

    it("sincroniza el tripId y status activo con locationService (MOVO-242, AC7)", async () => {
      mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "shipments") {
          return {
            data: [activeShipment("ship-1", "in_transit")],
            refetch: jest.fn(),
          };
        }
        if (queryKey[0] === "trips") {
          return {
            data: {
              items: [
                {
                  id: "trip-999",
                  status: "active",
                },
              ],
            },
            refetch: jest.fn(),
          };
        }
        return { data: undefined, refetch: jest.fn() };
      });

      const { result } = await renderHook(() => useCarrierTrackingCoordinator());

      expect(result.current.trackableCount).toBe(1);
      expect(locationService.updateActiveShipments).toHaveBeenCalledWith(
        ["ship-1"],
        "trip-999",
        "active"
      );
    });

    it("reporta un lote con ambos shipmentId para un viaje con envíos assigned e in_transit (DoD MOVO-242)", async () => {
      mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "shipments") {
          return {
            data: [
              activeShipment("ship-assigned", "assigned"),
              activeShipment("ship-intransit", "in_transit"),
            ],
            refetch: jest.fn(),
          };
        }
        if (queryKey[0] === "trips") {
          return {
            data: {
              items: [{ id: "trip-100", status: "active" }],
            },
            refetch: jest.fn(),
          };
        }
        return { data: undefined, refetch: jest.fn() };
      });

      const { result } = await renderHook(() => useCarrierTrackingCoordinator());

      expect(result.current.trackableCount).toBe(2);
      expect(locationService.updateActiveShipments).toHaveBeenCalledWith(
        ["ship-assigned", "ship-intransit"],
        "trip-100",
        "active"
      );
    });

    it("mantiene el tracking activo cuando se entrega el in_transit y queda solo el assigned (DoD MOVO-242)", async () => {
      const { result, rerender } = await renderHook(
        ({ shipments }: { shipments: ActiveShipmentSummary[] }) => {
          mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
            if (queryKey[0] === "shipments") {
              return {
                data: shipments,
                refetch: jest.fn(),
              };
            }
            if (queryKey[0] === "trips") {
              return {
                data: {
                  items: [{ id: "trip-100", status: "active" }],
                },
                refetch: jest.fn(),
              };
            }
            return { data: undefined, refetch: jest.fn() };
          });
          return useCarrierTrackingCoordinator();
        },
        {
          initialProps: {
            shipments: [
              activeShipment("ship-assigned", "assigned"),
              activeShipment("ship-intransit", "in_transit"),
            ],
          },
        }
      );

      expect(result.current.trackableCount).toBe(2);

      // El in_transit se entrega -> solo queda el assigned sin retirar todavía
      await act(async () => {
        rerender({
          shipments: [activeShipment("ship-assigned", "assigned")],
        });
      });

      expect(result.current.trackableCount).toBe(1);
      expect(locationService.updateActiveShipments).toHaveBeenLastCalledWith(
        ["ship-assigned"],
        "trip-100",
        "active"
      );
      expect(locationService.stopTracking).not.toHaveBeenCalled();
    });

    it("detiene el tracking si no hay envíos trackeables ni viaje activo (AC5, AC7)", async () => {
      mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "shipments") {
          return {
            data: [activeShipment("ship-unfunded", "assigned_unfunded")],
            refetch: jest.fn(),
          };
        }
        return { data: undefined, refetch: jest.fn() };
      });

      const { result } = await renderHook(() => useCarrierTrackingCoordinator());

      expect(result.current.trackableCount).toBe(0);
      expect(locationService.updateActiveShipments).toHaveBeenCalledWith([], null, null);
    });

    it("detiene el tracking si el viaje activo pasa a completado o cancelado (MOVO-242)", async () => {
      let isTripActive = true;
      mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
        if (queryKey[0] === "shipments") {
          return {
            data: [activeShipment("ship-1", "in_transit")],
            refetch: jest.fn(),
          };
        }
        if (queryKey[0] === "trips") {
          return {
            data: isTripActive
              ? { items: [{ id: "trip-active-1", status: "active" }] }
              : { items: [] },
            refetch: jest.fn(),
          };
        }
        return { data: undefined, refetch: jest.fn() };
      });

      const { rerender } = await renderHook(() => useCarrierTrackingCoordinator());

      expect(locationService.updateActiveShipments).toHaveBeenCalledWith(
        ["ship-1"],
        "trip-active-1",
        "active"
      );

      // El viaje activo finaliza (desaparece de activeTrips)
      isTripActive = false;
      await act(async () => {
        rerender({});
      });

      expect(locationService.updateActiveShipments).toHaveBeenLastCalledWith(
        ["ship-1"],
        null,
        "completed"
      );
    });
  });

  describe("useCarrierTracking (consumidor)", () => {
    it("permite solicitar permisos de ubicación en primer plano y sincroniza el estado compartido", async () => {
      const { result } = await renderHook(() => useCarrierTracking());

      let granted = false;
      await act(async () => {
        granted = await result.current.requestPermission();
      });

      expect(granted).toBe(true);
      expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
      expect(result.current.permissionGranted).toBe(true);
      expect(locationService.getStatus().permissionGranted).toBe(true);
    });

    it("permite solicitar permisos de ubicación en segundo plano (Etapa 2, MOVO-242)", async () => {
      const { result } = await renderHook(() => useCarrierTracking());

      let bgGranted = false;
      await act(async () => {
        bgGranted = await result.current.requestBackgroundPermission();
      });

      expect(bgGranted).toBe(true);
      expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalled();
      expect(result.current.backgroundPermissionGranted).toBe(true);
    });

    it("sincroniza permissionGranted entre múltiples instancias sin desfasaje", async () => {
      const hook1 = await renderHook(() => useCarrierTracking());
      const hook2 = await renderHook(() => useCarrierTracking());

      expect(hook1.result.current.permissionGranted).toBe(null);
      expect(hook2.result.current.permissionGranted).toBe(null);

      await act(async () => {
        await hook1.result.current.requestPermission();
      });

      expect(hook1.result.current.permissionGranted).toBe(true);
      expect(hook2.result.current.permissionGranted).toBe(true);
    });
  });
});
