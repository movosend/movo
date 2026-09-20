import { act, renderHook, waitFor } from "@testing-library/react-native";
import { getCurrentLocation } from "../src/lib/location";
import { shipmentsClient } from "../src/api/shipments-client";
import { useOptimizedRoute } from "../src/hooks/use-optimized-route";
import type { CarrierRoute } from "@movo/shared/dist/types/routing";

jest.mock("../src/lib/location", () => ({
  getCurrentLocation: jest.fn(),
}));

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: {
    getMyRoute: jest.fn(),
  },
}));

// Mock de expo-router useFocusEffect usando require("react") adentro
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    React.useEffect(() => {
      return cb();
    }, [cb]);
  },
}));

describe("useOptimizedRoute (MOVO-207)", () => {
  const mockCarrierLocation = { granted: true as const, lat: -31.4167, lng: -64.1833 };
  const mockRoute: CarrierRoute = {
    stops: [
      {
        stopOrder: 1,
        shipmentId: "ship-1",
        type: "pickup",
        lat: -31.42,
        lng: -64.18,
        estimatedArrivalMinutes: 5,
        estimatedArrivalAt: "2026-09-15T10:05:00.000Z",
        outsideTimeWindow: false,
      },
      {
        stopOrder: 2,
        shipmentId: "ship-1",
        type: "delivery",
        lat: -31.43,
        lng: -64.19,
        estimatedArrivalMinutes: 20,
        estimatedArrivalAt: "2026-09-15T10:20:00.000Z",
        outsideTimeWindow: false,
      },
    ],
    totalDistanceKm: 8.5,
    totalDurationMinutes: 25,
    optimized: true,
    disclaimer: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("AC8: si el GPS no tiene permiso (granted: false), marca gpsPermissionDenied sin llamar al backend", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValueOnce({ granted: false });

    const { result } = await renderHook(() => useOptimizedRoute());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.gpsPermissionDenied).toBe(true);
    expect(result.current.route).toBeNull();
    expect(shipmentsClient.getMyRoute).not.toHaveBeenCalled();
  });

  it("AC2/AC4: si el GPS está disponible, llama a shipmentsClient.getMyRoute con las coordenadas reales", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValueOnce(mockCarrierLocation);
    (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValueOnce(mockRoute);

    const { result } = await renderHook(() => useOptimizedRoute());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.gpsPermissionDenied).toBe(false);
    expect(result.current.carrierLocation).toEqual({ lat: -31.4167, lng: -64.1833 });
    expect(shipmentsClient.getMyRoute).toHaveBeenCalledWith({ lat: -31.4167, lng: -64.1833 });
    expect(result.current.route).toEqual(mockRoute);
    expect(result.current.error).toBeNull();
  });

  it("maneja errores de la API seteando mensaje amigable", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValueOnce(mockCarrierLocation);
    (shipmentsClient.getMyRoute as jest.Mock).mockRejectedValueOnce(new Error("Network timeout"));

    const { result } = await renderHook(() => useOptimizedRoute());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.route).toBeNull();
  });

  it("refetch vuelve a consultar GPS y ruta", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
    (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValue(mockRoute);

    const { result } = await renderHook(() => useOptimizedRoute());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(shipmentsClient.getMyRoute).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(shipmentsClient.getMyRoute).toHaveBeenCalledTimes(2);
  });

  it("Finding 3: un refetch fallido limpia la ruta anterior y setea el error para no tener estado mixto", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
    (shipmentsClient.getMyRoute as jest.Mock)
      .mockResolvedValueOnce(mockRoute)
      .mockRejectedValueOnce(new Error("Network drop"));

    const { result } = await renderHook(() => useOptimizedRoute());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.route).toEqual(mockRoute);
    expect(result.current.error).toBeNull();

    // Disparar refetch fallido
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.route).toBeNull();
  });

  it("Finding 2: ignora respuestas desfasadas de llamadas solapadas o fuera de orden", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);

    let resolveFirst!: (value: CarrierRoute) => void;
    const firstPromise = new Promise<CarrierRoute>((res) => {
      resolveFirst = res;
    });

    const secondRoute: CarrierRoute = {
      ...mockRoute,
      totalDistanceKm: 15.0,
    };

    (shipmentsClient.getMyRoute as jest.Mock)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(secondRoute);

    const { result } = await renderHook(() => useOptimizedRoute());

    // Iniciar refetch (segunda petición) antes de que termine la primera
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.route).toEqual(secondRoute);

    // Resolver la primera llamada (desfasada / obsoleta)
    await act(async () => {
      resolveFirst(mockRoute);
    });

    // La respuesta vieja NO debe sobreescribir los datos frescos de la segunda llamada
    expect(result.current.route).toEqual(secondRoute);
  });
});
