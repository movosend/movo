import React from "react";
import { render, fireEvent, act } from "@testing-library/react-native";
import OptimizedRouteScreen from "../app/(app)/route/index";
import { useOptimizedRoute } from "../src/hooks/use-optimized-route";
import { router } from "expo-router";
import type { CarrierRoute } from "@movo/shared/dist/types/routing";

jest.mock("../src/hooks/use-optimized-route");

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
  },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const React = require("react");
    React.useEffect(() => {
      return cb();
    }, [cb]);
  },
}));

describe("OptimizedRouteScreen (MOVO-207)", () => {
  const mockRefetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("muestra el estado de carga mientras obtiene la ruta", async () => {
    (useOptimizedRoute as jest.Mock).mockReturnValue({
      route: null,
      carrierLocation: null,
      isLoading: true,
      isRefreshing: false,
      gpsPermissionDenied: false,
      error: null,
      refetch: mockRefetch,
    });

    const { getByTestId, getByText } = await render(<OptimizedRouteScreen />);

    expect(getByTestId("route-loading-state")).toBeTruthy();
    expect(getByText("Calculando la mejor ruta...")).toBeTruthy();
  });

  it("AC8: muestra el estado de permiso de GPS denegado con botón para reintentar", async () => {
    (useOptimizedRoute as jest.Mock).mockReturnValue({
      route: null,
      carrierLocation: null,
      isLoading: false,
      isRefreshing: false,
      gpsPermissionDenied: true,
      error: null,
      refetch: mockRefetch,
    });

    const { getByTestId, getByText } = await render(<OptimizedRouteScreen />);

    expect(getByTestId("route-gps-denied-state")).toBeTruthy();
    expect(getByText("Permiso de ubicación necesario")).toBeTruthy();

    fireEvent.press(getByTestId("route-retry-gps-button"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("muestra estado de error general si falla el servicio", async () => {
    (useOptimizedRoute as jest.Mock).mockReturnValue({
      route: null,
      carrierLocation: null,
      isLoading: false,
      isRefreshing: false,
      gpsPermissionDenied: false,
      error: "Servicio de ruteo no disponible temporalmente.",
      refetch: mockRefetch,
    });

    const { getByTestId, getByText } = await render(<OptimizedRouteScreen />);

    expect(getByTestId("route-error-state")).toBeTruthy();
    expect(getByText("No pudimos cargar tu ruta")).toBeTruthy();
    expect(getByText("Servicio de ruteo no disponible temporalmente.")).toBeTruthy();

    fireEvent.press(getByTestId("route-retry-error-button"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("AC10: muestra estado vacío cuando el transportista no tiene paradas asignadas sin 'viaje en curso'", async () => {
    (useOptimizedRoute as jest.Mock).mockReturnValue({
      route: {
        stops: [],
        totalDistanceKm: 0,
        totalDurationMinutes: 0,
        optimized: true,
        disclaimer: null,
      },
      carrierLocation: { lat: -31.4167, lng: -64.1833 },
      isLoading: false,
      isRefreshing: false,
      gpsPermissionDenied: false,
      error: null,
      refetch: mockRefetch,
    });

    const { getByTestId, getByText, queryByTestId, queryByText } = await render(<OptimizedRouteScreen />);

    expect(getByTestId("route-empty-state")).toBeTruthy();
    expect(getByText("Sin paradas asignadas")).toBeTruthy();
    expect(getByText("Mi ruta de hoy")).toBeTruthy();

    // No debe mostrar isla flotante de viaje en curso ni conteo inválido "parada 1 de 0"
    expect(queryByTestId("route-floating-island")).toBeNull();
    expect(queryByText(/viaje en curso/i)).toBeNull();
    expect(queryByText(/parada 1 de 0/i)).toBeNull();

    fireEvent.press(getByTestId("route-explore-shipments-button"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/transport");
  });

  it("AC2/AC4: renderiza isla flotante, mapa y lista de paradas cuando hay ruta activa", async () => {
    const activeRoute: CarrierRoute = {
      stops: [
        {
          stopOrder: 1,
          shipmentId: "ship-1",
          type: "pickup",
          lat: -31.42,
          lng: -64.18,
          address: "Centro Córdoba",
          estimatedArrivalMinutes: 5,
          outsideTimeWindow: false,
        },
        {
          stopOrder: 2,
          shipmentId: "ship-1",
          type: "delivery",
          lat: -31.43,
          lng: -64.19,
          address: "Nueva Córdoba",
          estimatedArrivalMinutes: 20,
          outsideTimeWindow: false,
        },
      ],
      totalDistanceKm: 12.5,
      totalDurationMinutes: 30,
      optimized: true,
      disclaimer: null,
    };

    (useOptimizedRoute as jest.Mock).mockReturnValue({
      route: activeRoute,
      carrierLocation: { lat: -31.4167, lng: -64.1833 },
      isLoading: false,
      isRefreshing: false,
      gpsPermissionDenied: false,
      error: null,
      refetch: mockRefetch,
    });

    const { getByTestId, getByText } = await render(<OptimizedRouteScreen />);

    // Isla flotante de viaje en curso (Claude Design)
    expect(getByTestId("route-floating-island")).toBeTruthy();
    expect(getByText(/Viaje en curso/)).toBeTruthy();
    expect(getByText(/Parada 1 de 2 · Centro Córdoba/)).toBeTruthy();

    // Mapa y controles
    expect(getByTestId("route-mapview")).toBeTruthy();
    expect(getByTestId("route-bottom-sheet")).toBeTruthy();
    expect(getByTestId("stop-row-1")).toBeTruthy();
    expect(getByText("Centro Córdoba")).toBeTruthy();

    // Expandir itinerario para ver la siguiente parada
    await act(async () => {
      fireEvent.press(getByTestId("stop-list-toggle-sheet"));
    });
    expect(getByTestId("stop-row-2")).toBeTruthy();
    expect(getByText("Nueva Córdoba")).toBeTruthy();

    // Botón de volver / Inicio en la isla flotante
    await fireEvent.press(getByTestId("route-back-button"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);

    // Finding 7: Botón de refresco manual en la isla flotante cuando la ruta está activa
    await fireEvent.press(getByTestId("route-refresh-active-button"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);

    // Finding 1 / AC9: Al tocar "Retirar paquete" navega al wizard de retiro
    await fireEvent.press(getByTestId("stop-action-btn-1"));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/ship-1/pickup");
  });

  it("activa el recorrido demo al presionar el botón de prueba", async () => {
    (useOptimizedRoute as jest.Mock).mockReturnValue({
      route: {
        stops: [],
        totalDistanceKm: 0,
        totalDurationMinutes: 0,
        optimized: true,
        disclaimer: null,
      },
      carrierLocation: null,
      isLoading: false,
      isRefreshing: false,
      gpsPermissionDenied: false,
      error: null,
      refetch: mockRefetch,
    });

    const { getByTestId } = await render(<OptimizedRouteScreen />);
    const demoButton = getByTestId("route-demo-button");
    expect(demoButton).toBeTruthy();

    await act(async () => {
      fireEvent.press(demoButton);
    });
    expect(getByTestId("route-floating-island")).toBeTruthy();
    expect(getByTestId("route-mapview")).toBeTruthy();
    expect(getByTestId("route-exit-demo-button")).toBeTruthy();
  });
});
