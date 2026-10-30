import React from "react";
import { render } from "@testing-library/react-native";
import type { CarrierRoute } from "@movo/shared/dist/types/routing";
import OptimizedRouteScreen from "../app/(app)/route/index";
import { useOptimizedRoute } from "../src/hooks/use-optimized-route";

// MOVO-346 (punto 14): "Mi ruta" dibuja el camino por calles de `my-route`, recortado desde el vehículo.
// El mapa se reemplaza por un doble que guarda sus props; el resto de la pantalla, como en route-screen.test.tsx.
const mockRouteMapProps = jest.fn();
jest.mock("../components/route/route-map", () => ({
  RouteMap: (props: unknown) => {
    mockRouteMapProps(props);
    return null;
  },
}));
jest.mock("../src/hooks/use-carrier-requirements-sheet", () => require("./mocks/carrier-requirements-sheet-hook"));
jest.mock("../src/store/carrier-location-gate-store", () => ({
  requireCarrierLocation: (action: () => unknown) => action(),
}));
jest.mock("../src/hooks/use-optimized-route");
jest.mock("../src/hooks/use-stop-counterpart", () => ({ useStopCounterpartName: () => null }));
jest.mock("../src/hooks/use-trips", () => ({
  useTrip: () => ({ data: undefined, isLoading: false }),
  useStartTrip: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    require("react").useEffect(() => cb(), [cb]);
  },
}));

// Camino (-31.40,-64.18) → (-31.42,-64.18) → (-31.43,-64.19), pedido con el vehículo en el primer punto.
const POLYLINE = "~xs~D~cvfK~{B?n}@n}@";

function route(polyline: string | null): CarrierRoute {
  return {
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
    polyline,
  };
}

function mockRoute(polyline: string | null, carrierLocation: { lat: number; lng: number }) {
  (useOptimizedRoute as jest.Mock).mockReturnValue({
    route: route(polyline),
    carrierLocation,
    isLoading: false,
    isRefreshing: false,
    gpsPermissionDenied: false,
    error: null,
    refetch: jest.fn(),
  });
}

const lastPolyline = () => mockRouteMapProps.mock.calls.at(-1)?.[0].polylineCoordinates;

describe("Mi ruta: camino por calles (MOVO-346)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("dibuja el polyline recortado: arranca en el vehículo, sin la cola que quedó atrás", async () => {
    // El vehículo ya avanzó hasta la mitad del primer tramo.
    mockRoute(POLYLINE, { lat: -31.41, lng: -64.18 });

    await render(<OptimizedRouteScreen />);

    const coordinates = lastPolyline();
    expect(coordinates[0]).toEqual({ latitude: -31.41, longitude: -64.18 });
    expect(coordinates.some((p: { latitude: number }) => p.latitude === -31.4)).toBe(false);
    expect(coordinates.at(-1)).toEqual({ latitude: -31.43, longitude: -64.19 });
  });

  it("sin polyline (el proveedor falló) no le pasa coordenadas: el mapa une las paradas con rectas", async () => {
    mockRoute(null, { lat: -31.41, lng: -64.18 });

    await render(<OptimizedRouteScreen />);

    expect(lastPolyline()).toBeUndefined();
  });
});
