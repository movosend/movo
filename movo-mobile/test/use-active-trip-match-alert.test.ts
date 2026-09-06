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

// Debe coincidir con `TRIP_MATCH_STARTUP_DELAY_MS` (no exportado por el hook, mismo
// criterio que el resto del archivo con `TRIP_MATCH_SNOOZE_MS`/el intervalo de poll).
const STARTUP_DELAY_MS = 10_000;

async function skipStartupDelay() {
  await act(async () => {
    jest.advanceTimersByTime(STARTUP_DELAY_MS);
  });
}

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

function match(id: string, hasMyOffer = false) {
  return { id, hasMyOffer };
}

function matchesResult(
  items: Array<{ id: string; hasMyOffer: boolean }>,
  refetch = jest.fn(),
  dataUpdatedAt = 0,
) {
  return {
    data: { items, page: 1, limit: 5, total: items.length, tripId: "trip-1", radiusKm: 15 },
    refetch,
    dataUpdatedAt,
  };
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
    mockUseQuery.mockReturnValue({ data: undefined, refetch: jest.fn(), dataUpdatedAt: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("sin ningún viaje `active`, no hay alerta", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 } });

    const { result } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();

    expect(result.current.alert).toBeNull();
  });

  it("antes de que pase el delay de arranque (10s), no alerta aunque haya un match pendiente", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a")]));

    const { result } = await renderHook(() => useActiveTripMatchAlert());

    expect(result.current.alert).toBeNull();
  });

  it("ya en la primera respuesta alerta con todos los matches pendientes (a diferencia de la v1, no siembra en silencio)", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a"), match("b")]));

    const { result } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();

    expect(result.current.alert).toEqual({ tripId: "trip-1", shipments: [match("a"), match("b")] });
  });

  it("excluye los matches sobre los que ya ofertó (hasMyOffer: true)", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a", true), match("b")]));

    const { result } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();

    expect(result.current.alert).toEqual({ tripId: "trip-1", shipments: [match("b")] });
  });

  it("sin ningún match pendiente (todos con oferta), no hay alerta", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a", true)]));

    const { result } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();

    expect(result.current.alert).toBeNull();
  });

  it("si un match deja de estar pendiente entre polls (ya ofertó en otro lado), desaparece de la alerta", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a"), match("b")]));

    const { result, rerender } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();
    expect(result.current.alert?.shipments).toHaveLength(2);

    mockUseQuery.mockReturnValue(matchesResult([match("a", true), match("b")]));
    await rerender({});

    expect(result.current.alert).toEqual({ tripId: "trip-1", shipments: [match("b")] });
  });

  it("dismiss() limpia la alerta activa", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a")]));

    const { result } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();
    expect(result.current.alert).not.toBeNull();

    await act(async () => {
      result.current.dismiss();
    });

    expect(result.current.alert).toBeNull();
  });

  it("tras descartar, el aviso completo queda pospuesto hasta que pase el snooze (5 min)", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    const refetch = jest.fn();
    // Misma referencia de `data` en los tres polls (structural sharing real de
    // TanStack Query: un poll cuyo contenido no cambió conserva el mismo objeto) —
    // solo `dataUpdatedAt` avanza, como en un poll real. Regresión real: el efecto de
    // detección dependía únicamente de `matchesQuery.data`, así que con la misma
    // referencia nunca volvía a evaluarse después del snooze.
    const stableData = matchesResult([match("a")], refetch, 1_000).data;
    mockUseQuery.mockReturnValue({ data: stableData, refetch, dataUpdatedAt: 1_000 });

    const { result, rerender } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();
    await act(async () => {
      result.current.dismiss();
    });

    // Un poll a los 30s, todavía dentro de la ventana de 5 min de snooze: no reaparece.
    jest.advanceTimersByTime(30_000);
    mockUseQuery.mockReturnValue({ data: stableData, refetch, dataUpdatedAt: 2_000 });
    await rerender({});
    expect(result.current.alert).toBeNull();

    // Pasado el snooze completo (5 min desde el dismiss): el mismo envío, todavía
    // pendiente, puede volver a aparecer — pedido explícito del usuario ("que cada
    // cierto tiempo vuelva a aparecer") — con la MISMA referencia de `data` de antes.
    jest.advanceTimersByTime(5 * 60_000);
    mockUseQuery.mockReturnValue({ data: stableData, refetch, dataUpdatedAt: 3_000 });
    await rerender({});
    expect(result.current.alert).toEqual({ tripId: "trip-1", shipments: [match("a")] });
  });

  it("al reabrir la app (hook remontado de cero), un match pendiente ya existente alerta de entrada tras su propio delay de arranque", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a")]));

    const { result: firstSession } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();
    await act(async () => {
      firstSession.current.dismiss();
    });
    expect(firstSession.current.alert).toBeNull();

    // Simula relanzar la app: un hook nuevo, sin el snooze en memoria de la sesión
    // anterior — el mismo match sigue pendiente y debería alertar (tras su propio
    // delay de arranque), no esperar los 5 minutos de snooze de la sesión anterior.
    const { result: secondSession } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();
    expect(secondSession.current.alert).toEqual({ tripId: "trip-1", shipments: [match("a")] });
  });

  it("cambiar de viaje activo resetea el snooze — un envío pospuesto para el viaje anterior puede alertar igual para el nuevo", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [trip({ id: "trip-1" })], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("shared-id")]));

    const { result, rerender } = await renderHook(() => useActiveTripMatchAlert());
    await skipStartupDelay();
    await act(async () => {
      result.current.dismiss();
    });
    expect(result.current.alert).toBeNull();

    // Otro viaje activo, que por casualidad matchea un envío con el mismo id que ya
    // se había pospuesto para el viaje anterior.
    mockUseMyTrips.mockReturnValue({ data: { items: [trip({ id: "trip-2" })], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("shared-id")]));
    await rerender({});

    expect(result.current.alert).toEqual({ tripId: "trip-2", shipments: [match("shared-id")] });
  });

  it("pausa el polling en background y lo retoma (con refetch inmediato) al volver a foreground", async () => {
    const refetch = jest.fn();
    mockUseMyTrips.mockReturnValue({ data: { items: [trip()], page: 1, limit: 50, total: 1 } });
    mockUseQuery.mockReturnValue(matchesResult([match("a")], refetch));

    await renderHook(() => useActiveTripMatchAlert());
    expect(appStateListener).toBeDefined();

    // Este avance de 30s también cruza el delay de arranque de 10s (dispara un
    // `setState` propio) — envuelto en `act` para evitar el warning de RNTL.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
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
