import { act, renderHook, waitFor } from "@testing-library/react-native";
import { getCurrentLocation } from "../src/lib/location";
import { shipmentsClient } from "../src/api/shipments-client";
import { clearOptimizedRouteCache, useOptimizedRoute } from "../src/hooks/use-optimized-route";
import { useAuthStore } from "../src/store/auth-store";
import type { CarrierRoute } from "@movo/shared/dist/types/routing";

const mockStopWatching = jest.fn();
let mockOnWatchedLocation: ((coords: { lat: number; lng: number }) => void) | null = null;
jest.mock("../src/lib/location", () => ({
  getCurrentLocation: jest.fn(),
  watchForegroundLocation: jest.fn(async (onChange: (coords: { lat: number; lng: number }) => void) => {
    mockOnWatchedLocation = onChange;
    return mockStopWatching;
  }),
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
    clearOptimizedRouteCache();
    mockOnWatchedLocation = null;
  });

  describe("feedback de TestFlight build 18", () => {
    it("al volver a entrar muestra la última ruta del viaje sin la pantalla de carga", async () => {
      (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
      (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValue(mockRoute);
      const first = await renderHook(() => useOptimizedRoute("trip-1"));
      await waitFor(() => expect(first.result.current.route).toEqual(mockRoute));
      await first.unmount();

      (shipmentsClient.getMyRoute as jest.Mock).mockReturnValue(new Promise(() => undefined));
      const second = await renderHook(() => useOptimizedRoute("trip-1"));
      expect(second.result.current.isLoading).toBe(false);
      expect(second.result.current.route).toEqual(mockRoute);
      await second.unmount();
    });

    it("otra cuenta en el mismo teléfono no ve la ruta guardada de la anterior", async () => {
      (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
      (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValue(mockRoute);
      useAuthStore.setState({ user: { userId: "carrier-a" } as never });
      const first = await renderHook(() => useOptimizedRoute());
      await waitFor(() => expect(first.result.current.route).toEqual(mockRoute));
      await first.unmount();

      useAuthStore.setState({ user: { userId: "carrier-b" } as never });
      (shipmentsClient.getMyRoute as jest.Mock).mockReturnValue(new Promise(() => undefined));
      const second = await renderHook(() => useOptimizedRoute());
      expect(second.result.current.isLoading).toBe(true);
      expect(second.result.current.route).toBeNull();
      await second.unmount();
      useAuthStore.setState({ user: null });
    });

    it("si el pedido falla, la ruta que vino solo del cache no queda en pantalla", async () => {
      (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
      (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValue(mockRoute);
      const first = await renderHook(() => useOptimizedRoute("trip-1"));
      await waitFor(() => expect(first.result.current.route).toEqual(mockRoute));
      await first.unmount();

      (shipmentsClient.getMyRoute as jest.Mock).mockRejectedValue(new Error("viaje terminado"));
      const second = await renderHook(() => useOptimizedRoute("trip-1"));
      await waitFor(() => expect(second.result.current.error).not.toBeNull());
      expect(second.result.current.route).toBeNull();
      await second.unmount();

      // Y no vuelve a aparecer en la próxima entrada.
      (shipmentsClient.getMyRoute as jest.Mock).mockReturnValue(new Promise(() => undefined));
      const third = await renderHook(() => useOptimizedRoute("trip-1"));
      expect(third.result.current.route).toBeNull();
      await third.unmount();
    });

    it("con la pantalla enfocada, la posición del transportista sigue al GPS y se corta al salir", async () => {
      (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
      (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValue(mockRoute);
      const { result, unmount } = await renderHook(() => useOptimizedRoute("trip-1"));
      await waitFor(() => expect(mockOnWatchedLocation).not.toBeNull());
      await waitFor(() => expect(result.current.route).toEqual(mockRoute));

      await act(async () => mockOnWatchedLocation?.({ lat: -31.5, lng: -64.3 }));
      expect(result.current.carrierLocation).toEqual({ lat: -31.5, lng: -64.3 });

      await unmount();
      expect(mockStopWatching).toHaveBeenCalled();
    });
  });

  describe("rumbo hacia my-route (MOVO-357)", () => {
    it("manda el rumbo del fix si viene, sin agregarlo a la posición del mapa", async () => {
      (getCurrentLocation as jest.Mock).mockResolvedValue({ ...mockCarrierLocation, heading: 180 });
      (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValue(mockRoute);
      const { result, unmount } = await renderHook(() => useOptimizedRoute("trip-1"));
      await waitFor(() => expect(result.current.route).toEqual(mockRoute));

      expect(shipmentsClient.getMyRoute).toHaveBeenCalledWith({ lat: -31.4167, lng: -64.1833, heading: 180 }, "trip-1");
      expect(result.current.carrierLocation).toEqual({ lat: -31.4167, lng: -64.1833 });
      await unmount();
    });

    it("el primer rumbo del seguimiento vuelve a pedir la ruta una sola vez, para que el backend rearme la línea", async () => {
      (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
      (shipmentsClient.getMyRoute as jest.Mock).mockResolvedValue(mockRoute);
      const { result, unmount } = await renderHook(() => useOptimizedRoute("trip-1"));
      await waitFor(() => expect(mockOnWatchedLocation).not.toBeNull());
      await waitFor(() => expect(result.current.route).toEqual(mockRoute));
      expect(shipmentsClient.getMyRoute).toHaveBeenCalledTimes(1);
      expect(shipmentsClient.getMyRoute).toHaveBeenLastCalledWith({ lat: -31.4167, lng: -64.1833 }, "trip-1");

      // El pedido que dispara toma un fix nuevo (el del mock), así que la posición vuelve a la de ese fix.
      await act(async () => mockOnWatchedLocation?.({ lat: -31.5, lng: -64.3, heading: 45 } as never));
      expect(result.current.carrierHeading).toBe(45);
      await waitFor(() => expect(shipmentsClient.getMyRoute).toHaveBeenCalledTimes(2));
      expect(shipmentsClient.getMyRoute).toHaveBeenLastCalledWith(
        { lat: -31.4167, lng: -64.1833, heading: 45 },
        "trip-1",
      );

      // Más rumbos en la misma visita no vuelven a pedir.
      await act(async () => mockOnWatchedLocation?.({ lat: -31.51, lng: -64.3, heading: 50 } as never));
      await act(async () => mockOnWatchedLocation?.({ lat: -31.52, lng: -64.3 } as never));
      expect(shipmentsClient.getMyRoute).toHaveBeenCalledTimes(2);
      expect(result.current.carrierHeading).toBeUndefined();
      await unmount();
    });
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

  it("Finding 3: un refetch fallido preserva la ruta existente y setea el error (no deja la pantalla vacía)", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue(mockCarrierLocation);
    (shipmentsClient.getMyRoute as jest.Mock)
      .mockResolvedValueOnce(mockRoute)
      .mockRejectedValueOnce(new Error("Network drop"));

    const { result } = await renderHook(() => useOptimizedRoute());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.route).toEqual(mockRoute);
    expect(result.current.error).toBeNull();

    // Disparar refetch fallido (isRefresh=true preserva la ruta anterior)
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeTruthy();
    // La ruta existente se preserva para no dejar la pantalla en blanco
    expect(result.current.route).toEqual(mockRoute);
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
