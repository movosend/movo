import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import MyTripsScreen from "../app/(app)/carrier/trips/index";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";

// El gate de ubicación del transportista tiene su propio test
// (carrier-location-gate.test.tsx): acá se asume que ya cumple los requisitos.
jest.mock("../src/store/carrier-location-gate-store", () => ({
  requireCarrierLocation: (action: () => unknown) => action(),
}));

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}) as { created?: string; cancelledTo?: string; cancelledAt?: string });

jest.mock("expo-router", () => ({
  router: {
    back: () => mockRouterBack(),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const mockUseMyTrips = jest.fn();

jest.mock("../src/hooks/use-trips", () => ({
  useMyTripsPaged: (...args: unknown[]) => mockUseMyTrips(...args),
}));

const mockDiffAndMarkSeenTrips = jest.fn().mockResolvedValue({ newTripIds: [] });
jest.mock("../src/lib/seen-trips", () => ({
  diffAndMarkSeenTrips: (ids: string[]) => mockDiffAndMarkSeenTrips(ids),
}));

const TRIP_A: TripWithAcceptedPackages = {
  id: "trip-1",
  carrierId: "carrier-1",
  originAddress: "Av. Colón 1234, Córdoba",
  originLat: -31.4201,
  originLng: -64.1888,
  destinationAddress: "Av. San Martín 100, Villa María",
  destinationLat: -32.4104,
  destinationLng: -63.2404,
  departureAt: "2026-09-10T12:00:00.000Z",
  vehicleType: "Auto",
  // MOVO-221 (fix de review, PR #168): declared es el estado real de un viaje recién
  // creado -- antes de este fix quedaba hardcodeado en ACTIVE y nunca ejercitaba el
  // bug real (editar/eliminar no se mostraban para un viaje declared).
  status: TripStatus.DECLARED,
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
  cancelledAt: null,
  hasAcceptedPackages: false,
  acceptedPackagesCount: 0,
};

const TRIP_ACTIVE: TripWithAcceptedPackages = { ...TRIP_A, id: "trip-active", status: TripStatus.ACTIVE };
const TRIP_BLOCKED: TripWithAcceptedPackages = { ...TRIP_A, id: "trip-2", hasAcceptedPackages: true, acceptedPackagesCount: 1 };
const TRIP_CANCELLED: TripWithAcceptedPackages = {
  ...TRIP_A,
  id: "trip-3",
  status: TripStatus.CANCELLED,
  cancelledAt: "2026-09-12T15:00:00.000Z",
};
const TRIP_EXPIRED: TripWithAcceptedPackages = { ...TRIP_A, id: "trip-4", status: TripStatus.EXPIRED };
const TRIP_COMPLETED: TripWithAcceptedPackages = {
  ...TRIP_A,
  id: "trip-5",
  status: TripStatus.COMPLETED,
  hasAcceptedPackages: true,
  acceptedPackagesCount: 2,
};

const listOf = (...items: TripWithAcceptedPackages[]) => ({
  data: { pages: [{ items, page: 1, limit: 50, total: items.length }] },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
});

describe("MyTripsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // `mockReturnValue` no se limpia con `clearAllMocks` (solo mockClear/mockReset lo
    // hacen) — sin este reset explícito, un test que llama `mockReturnValue({created:
    // "1"})` deja el valor pisado para el resto de la suite.
    mockUseLocalSearchParams.mockReturnValue({});
  });

  it("muestra el skeleton mientras carga", async () => {
    mockUseMyTrips.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: jest.fn() });

    const { getByTestId, queryByTestId } = await render(<MyTripsScreen />);

    expect(getByTestId("my-trips-tabs")).toBeTruthy();
    expect(queryByTestId(`my-trips-card-${TRIP_A.id}`)).toBeNull();
  });

  it("muestra la confirmación de éxito al volver de declarar un viaje (?created=1)", async () => {
    mockUseLocalSearchParams.mockReturnValue({ created: "1" });
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A], page: 1, limit: 50, total: 1 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, getByText } = await render(<MyTripsScreen />);

    expect(getByTestId("my-trips-created-success")).toBeTruthy();
    expect(getByText("¡Viaje declarado!")).toBeTruthy();
  });

  it("no muestra la confirmación de éxito sin el param created", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A], page: 1, limit: 50, total: 1 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<MyTripsScreen />);

    expect(queryByTestId("my-trips-created-success")).toBeNull();
  });

  it("MOVO-236 AC2: muestra un banner in-app cuando el diff detecta un viaje nuevo (fallback sin push)", async () => {
    mockDiffAndMarkSeenTrips.mockResolvedValueOnce({ newTripIds: ["trip-1"] });
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A], page: 1, limit: 50, total: 1 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, getByText } = await render(<MyTripsScreen />);

    await waitFor(() => expect(mockDiffAndMarkSeenTrips).toHaveBeenCalledWith([TRIP_A.id]));
    expect(getByTestId("my-trips-auto-created-success")).toBeTruthy();
    expect(getByText("Se armó un viaje con un envío que aceptaste")).toBeTruthy();
  });

  it("MOVO-236 AC2: usa copy en plural cuando el diff detecta más de un viaje nuevo", async () => {
    mockDiffAndMarkSeenTrips.mockResolvedValueOnce({ newTripIds: ["trip-1", "trip-active"] });
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A, TRIP_ACTIVE], page: 1, limit: 50, total: 2 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<MyTripsScreen />);

    await waitFor(() => expect(getByText("Se armaron viajes nuevos con envíos que aceptaste")).toBeTruthy());
  });

  it("MOVO-236 AC2: sin viajes nuevos en el diff, no muestra ningún banner", async () => {
    mockDiffAndMarkSeenTrips.mockResolvedValueOnce({ newTripIds: [] });
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A], page: 1, limit: 50, total: 1 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<MyTripsScreen />);

    await waitFor(() => expect(mockDiffAndMarkSeenTrips).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(queryByTestId("my-trips-auto-created-success")).toBeNull();
  });

  it("MOVO-236 AC2: el banner de '¡Viaje declarado!' (?created=1) tiene prioridad sobre el de auto-creado", async () => {
    mockUseLocalSearchParams.mockReturnValue({ created: "1" });
    mockDiffAndMarkSeenTrips.mockResolvedValueOnce({ newTripIds: ["trip-1"] });
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A], page: 1, limit: 50, total: 1 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<MyTripsScreen />);

    expect(getByTestId("my-trips-created-success")).toBeTruthy();
    await waitFor(() => expect(mockDiffAndMarkSeenTrips).toHaveBeenCalled());
    expect(queryByTestId("my-trips-auto-created-success")).toBeNull();
  });

  it("muestra el estado de error con reintento", async () => {
    const refetch = jest.fn();
    mockUseMyTrips.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId("my-trips-retry"));

    expect(refetch).toHaveBeenCalled();
  });

  it("muestra el estado vacío con CTA cuando no hay viajes", async () => {
    mockUseMyTrips.mockReturnValue({ data: { pages: [{ items: [], page: 1, limit: 50, total: 0 }] }, isLoading: false, isError: false, refetch: jest.fn() });

    const { getByText, getByTestId } = await render(<MyTripsScreen />);

    expect(getByText("Todavía no declaraste ningún viaje.")).toBeTruthy();
    expect(getByTestId("my-trips-empty-add")).toBeTruthy();
  });

  it("lista los viajes declarados", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A], page: 1, limit: 50, total: 1 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<MyTripsScreen />);

    expect(getByTestId(`my-trips-card-${TRIP_A.id}`)).toBeTruthy();
  });

  it("MOVO-263 AC6: al volver de cancelar un viaje muestra el banner con el destino", async () => {
    mockUseLocalSearchParams.mockReturnValue({ cancelledTo: "Villa María" });
    mockUseMyTrips.mockReturnValue(listOf(TRIP_A));

    const { getByTestId, getByText } = await render(<MyTripsScreen />);

    expect(getByTestId("my-trips-cancelled-success")).toBeTruthy();
    expect(getByText("Cancelaste el viaje a Villa María")).toBeTruthy();
  });

  it("review PR #225: dos cancelaciones seguidas al mismo destino vuelven a mostrar el banner", async () => {
    mockUseLocalSearchParams.mockReturnValue({ cancelledTo: "Villa María", cancelledAt: "1" });
    mockUseMyTrips.mockReturnValue(listOf(TRIP_A));

    jest.useFakeTimers();
    try {
      const { getByTestId, queryByTestId, rerender } = await render(<MyTripsScreen />);
      expect(getByTestId("my-trips-cancelled-success")).toBeTruthy();

      // El banner se auto-oculta; el segundo aviso llega con el mismo destino.
      await act(async () => {
        jest.advanceTimersByTime(3500);
      });
      expect(queryByTestId("my-trips-cancelled-success")).toBeNull();

      mockUseLocalSearchParams.mockReturnValue({ cancelledTo: "Villa María", cancelledAt: "2" });
      await rerender(<MyTripsScreen />);
      expect(getByTestId("my-trips-cancelled-success")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it("review PR #219: tocar una card del historial abre el detalle del viaje", async () => {
    mockUseMyTrips.mockReturnValue(listOf(TRIP_COMPLETED));

    const { getByTestId } = await render(<MyTripsScreen />);
    await fireEvent.press(getByTestId("my-trips-tab-history"));
    await fireEvent.press(getByTestId(`my-trips-card-${TRIP_COMPLETED.id}`));

    expect(mockRouterPush).toHaveBeenCalledWith(`/carrier/trips/${TRIP_COMPLETED.id}`);
  });

  it("review PR #219: con más páginas ofrece 'Cargar más' y pide la siguiente", async () => {
    const fetchNextPage = jest.fn();
    mockUseMyTrips.mockReturnValue({ ...listOf(TRIP_A), hasNextPage: true, fetchNextPage, isFetchingNextPage: false });

    const { getByTestId } = await render(<MyTripsScreen />);
    await fireEvent.press(getByTestId("my-trips-load-more"));

    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("review PR #219: sin 'Cargar más' cuando no hay otra página", async () => {
    mockUseMyTrips.mockReturnValue({ ...listOf(TRIP_A), hasNextPage: false });

    const { queryByTestId } = await render(<MyTripsScreen />);

    expect(queryByTestId("my-trips-load-more")).toBeNull();
  });

  it("review PR #219: con 'Próximos' vacío no se duplica 'Declarar viaje' (barra oculta)", async () => {
    mockUseMyTrips.mockReturnValue(listOf());

    const { getByTestId, queryByTestId } = await render(<MyTripsScreen />);

    expect(getByTestId("my-trips-empty-add")).toBeTruthy();
    expect(queryByTestId("my-trips-add")).toBeNull();
  });

  it("review PR #219: el chip de aceptados nunca dice 'a bordo' (el conteo incluye entregados y por retirar)", async () => {
    mockUseMyTrips.mockReturnValue(listOf({ ...TRIP_ACTIVE, hasAcceptedPackages: true, acceptedPackagesCount: 3 }));

    const { getByText, queryByText } = await render(<MyTripsScreen />);

    expect(getByText("3 aceptados")).toBeTruthy();
    expect(queryByText(/a bordo/)).toBeNull();
  });

  it("MOVO-262 AC1: abre en 'Próximos' y cambiar a 'Historial' consulta con el scope correcto", async () => {
    mockUseMyTrips.mockReturnValue(listOf(TRIP_A));

    const { getByTestId } = await render(<MyTripsScreen />);
    expect(mockUseMyTrips).toHaveBeenLastCalledWith("upcoming");

    await fireEvent.press(getByTestId("my-trips-tab-history"));
    expect(mockUseMyTrips).toHaveBeenLastCalledWith("history");

    await fireEvent.press(getByTestId("my-trips-tab-upcoming"));
    expect(mockUseMyTrips).toHaveBeenLastCalledWith("upcoming");
  });

  it("MOVO-262 AC1: el estado vacío de cada tab tiene su propio copy; el CTA solo en Próximos", async () => {
    mockUseMyTrips.mockReturnValue(listOf());

    const { getByText, getByTestId, queryByTestId } = await render(<MyTripsScreen />);
    expect(getByText("Todavía no declaraste ningún viaje.")).toBeTruthy();
    expect(getByTestId("my-trips-empty-add")).toBeTruthy();

    await fireEvent.press(getByTestId("my-trips-tab-history"));
    expect(getByText("Todavía no tenés viajes terminados")).toBeTruthy();
    expect(queryByTestId("my-trips-empty-add")).toBeNull();
  });

  it("MOVO-262 AC2: pill por estado", async () => {
    mockUseMyTrips.mockReturnValue(listOf(TRIP_A, TRIP_ACTIVE));

    const { getByText, getByTestId } = await render(<MyTripsScreen />);

    expect(getByText("Declarado")).toBeTruthy();
    expect(getByText("En curso")).toBeTruthy();
    expect(getByTestId("trip-status-dot")).toBeTruthy();
  });

  it("MOVO-262 AC2/AC4: pills y subtexto del historial", async () => {
    mockUseMyTrips.mockReturnValue(listOf(TRIP_COMPLETED, TRIP_CANCELLED, TRIP_EXPIRED));

    const { getByText, getByTestId } = await render(<MyTripsScreen />);
    await fireEvent.press(getByTestId("my-trips-tab-history"));

    expect(getByText("Completado")).toBeTruthy();
    expect(getByText("Cancelado")).toBeTruthy();
    expect(getByText("Venció")).toBeTruthy();
    expect(getByText("Llevaste 2 paquetes")).toBeTruthy();
    expect(getByText("Sin paquetes aceptados")).toBeTruthy();
    expect(getByText(/^Lo cancelaste el /)).toBeTruthy();
  });

  it("MOVO-262 AC4: el historial se agrupa por mes", async () => {
    mockUseMyTrips.mockReturnValue(listOf(TRIP_COMPLETED, { ...TRIP_EXPIRED, departureAt: "2026-08-05T12:00:00.000Z" }));

    const { getByText, getByTestId } = await render(<MyTripsScreen />);
    await fireEvent.press(getByTestId("my-trips-tab-history"));

    expect(getByText("Septiembre 2026")).toBeTruthy();
    expect(getByText("Agosto 2026")).toBeTruthy();
  });

  it("MOVO-262 AC3: chip de paquetes aceptados, o 'Sin paquetes todavía'", async () => {
    mockUseMyTrips.mockReturnValue(listOf(TRIP_BLOCKED, TRIP_A));

    const { getByTestId, getByText, queryByText } = await render(<MyTripsScreen />);

    expect(getByTestId(`my-trips-card-${TRIP_BLOCKED.id}-accepted-badge`)).toBeTruthy();
    expect(getByText("1 aceptado")).toBeTruthy();
    expect(getByText("Sin paquetes todavía")).toBeTruthy();
    expect(queryByText("Buscar paquetes")).toBeNull();
    expect(queryByText(TRIP_A.vehicleType)).toBeNull();
    expect(queryByText(/no se puede modificar ni cancelar/)).toBeNull();
  });

  it("MOVO-262 AC5: tocar la card abre el detalle y no hay editar/eliminar", async () => {
    mockUseMyTrips.mockReturnValue(listOf(TRIP_A));

    const { getByTestId, queryByTestId } = await render(<MyTripsScreen />);
    expect(queryByTestId(`my-trips-card-${TRIP_A.id}-edit`)).toBeNull();
    expect(queryByTestId(`my-trips-card-${TRIP_A.id}-delete`)).toBeNull();

    await fireEvent.press(getByTestId(`my-trips-card-${TRIP_A.id}`));
    expect(mockRouterPush).toHaveBeenCalledWith(`/carrier/trips/${TRIP_A.id}`);
  });

  it("navega a declarar viaje desde el botón al pie", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { pages: [{ items: [TRIP_A], page: 1, limit: 50, total: 1 }] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<MyTripsScreen />);
    await fireEvent.press(getByTestId("my-trips-add"));

    expect(mockRouterPush).toHaveBeenCalledWith("/carrier/trips/new");
  });

  it("vuelve atrás al tocar el botón de back cuando hay historial", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockUseMyTrips.mockReturnValue({ data: { pages: [{ items: [], page: 1, limit: 50, total: 0 }] }, isLoading: false, isError: false, refetch: jest.fn() });

    const { getByTestId } = await render(<MyTripsScreen />);
    await fireEvent.press(getByTestId("my-trips-back"));

    expect(mockRouterBack).toHaveBeenCalled();
  });

  it("reemplaza a la tab de transportar si no hay historial", async () => {
    mockCanGoBack.mockReturnValue(false);
    mockUseMyTrips.mockReturnValue({ data: { pages: [{ items: [], page: 1, limit: 50, total: 0 }] }, isLoading: false, isError: false, refetch: jest.fn() });

    const { getByTestId } = await render(<MyTripsScreen />);
    await fireEvent.press(getByTestId("my-trips-back"));

    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/(tabs)/transport");
  });
});
