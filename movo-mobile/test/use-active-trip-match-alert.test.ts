import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";

const mockUseQuery = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

const mockUseMyTrips = jest.fn();
jest.mock("../src/hooks/use-trips", () => ({
  useMyTrips: () => mockUseMyTrips(),
}));

import { useActiveTripMatchAlert } from "../src/hooks/use-active-trip-match-alert";

function trip(overrides: Partial<TripWithAcceptedPackages> = {}): TripWithAcceptedPackages {
  return {
    id: "trip-1",
    carrierId: "carrier-1",
    originAddress: "Av. Colón 1234, Córdoba",
    originLat: -31.42,
    originLng: -64.18,
    destinationAddress: "Av. San Martín 100, Villa María",
    destinationLat: -32.41,
    destinationLng: -63.24,
    departureAt: "2026-09-10T12:00:00.000Z",
    vehicleType: "Auto",
    status: TripStatus.ACTIVE,
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
    hasAcceptedPackages: false,
    ...overrides,
  };
}

function matchesResult(items: Array<{ id: string }>, refetch = jest.fn()) {
  return { data: { items, page: 1, limit: 5, total: items.length, tripId: "trip-1", radiusKm: 15 }, refetch };
}

describe("useActiveTripMatchAlert", () => {
  let appStateListener: ((state: string) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    appStateListener = undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove: jest.fn() } as any;
    });
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
    mockUseQuery.mockReturnValue({ data: undefined, refetch: jest.fn() });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("sin ningún viaje `active`, no hay alerta", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 } });

    const { result } = await renderHook(() => useActiveTripMatchAlert());

    expect(result.current.alert).toBeNull();
  });

  it("siembra la primera respuesta sin alertar (no avisa por el historial ya existente)", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([{ id: "a" }, { id: "b" }]));

    const { result } = await renderHook(() => useActiveTripMatchAlert());

    expect(result.current.alert).toBeNull();
  });

  it("un match nuevo en un poll posterior sí alerta", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([{ id: "a" }]));

    const { result, rerender } = await renderHook(() => useActiveTripMatchAlert());
    expect(result.current.alert).toBeNull();

    mockUseQuery.mockReturnValue(matchesResult([{ id: "a" }, { id: "b" }]));
    await rerender({});

    expect(result.current.alert).toEqual({ tripId: "trip-1", newCount: 1 });
  });

  it("dismiss() limpia la alerta activa", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([{ id: "a" }]));

    const { result, rerender } = await renderHook(() => useActiveTripMatchAlert());
    mockUseQuery.mockReturnValue(matchesResult([{ id: "a" }, { id: "b" }]));
    await rerender({});
    expect(result.current.alert).not.toBeNull();

    await act(async () => {
      result.current.dismiss();
    });
    await rerender({});

    expect(result.current.alert).toBeNull();
  });

  it("cambiar de viaje activo resetea los 'ya vistos' sin alertar por el nuevo viaje", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip({ id: "trip-1" })], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([{ id: "shared-id" }]));

    const { result, rerender } = await renderHook(() => useActiveTripMatchAlert());
    expect(result.current.alert).toBeNull();

    // Otro viaje activo, que por casualidad matchea un envío con el mismo id que ya
    // se había visto para el viaje anterior — no debería contar como "nuevo".
    mockUseMyTrips.mockReturnValue({ data: { items: [trip({ id: "trip-2" })], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([{ id: "shared-id" }]));
    await rerender({});

    expect(result.current.alert).toBeNull();
  });

  it("pausa el polling en background y lo retoma (con refetch inmediato) al volver a foreground", async () => {
    const refetch = jest.fn();
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([{ id: "a" }], refetch));

    await renderHook(() => useActiveTripMatchAlert());
    expect(appStateListener).toBeDefined();

    jest.advanceTimersByTime(30_000);
    expect(refetch).toHaveBeenCalledTimes(1);

    appStateListener!("background");
    refetch.mockClear();
    jest.advanceTimersByTime(60_000);
    expect(refetch).not.toHaveBeenCalled();

    appStateListener!("active");
    expect(refetch).toHaveBeenCalledTimes(1);

    refetch.mockClear();
    jest.advanceTimersByTime(30_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
