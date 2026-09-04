import { fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import MyTripsScreen from "../app/(app)/carrier/trips/index";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}) as { created?: string });

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
const mockDeleteMutate = jest.fn();

jest.mock("../src/hooks/use-trips", () => ({
  useMyTrips: () => mockUseMyTrips(),
  useDeleteTrip: () => ({ mutate: mockDeleteMutate }),
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
  status: TripStatus.ACTIVE,
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
  hasAcceptedPackages: false,
};

const TRIP_BLOCKED: TripWithAcceptedPackages = { ...TRIP_A, id: "trip-2", hasAcceptedPackages: true };
const TRIP_CANCELLED: TripWithAcceptedPackages = { ...TRIP_A, id: "trip-3", status: TripStatus.CANCELLED };

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

    const { queryByTestId } = await render(<MyTripsScreen />);

    expect(queryByTestId("my-trips-add")).toBeNull();
  });

  it("muestra la confirmación de éxito al volver de declarar un viaje (?created=1)", async () => {
    mockUseLocalSearchParams.mockReturnValue({ created: "1" });
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
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
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<MyTripsScreen />);

    expect(queryByTestId("my-trips-created-success")).toBeNull();
  });

  it("muestra el estado de error con reintento", async () => {
    const refetch = jest.fn();
    mockUseMyTrips.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId("my-trips-retry"));

    expect(refetch).toHaveBeenCalled();
  });

  it("muestra el estado vacío con CTA cuando no hay viajes", async () => {
    mockUseMyTrips.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 }, isLoading: false, isError: false, refetch: jest.fn() });

    const { getByText, getByTestId } = await render(<MyTripsScreen />);

    expect(getByText("Todavía no declaraste ningún viaje.")).toBeTruthy();
    expect(getByTestId("my-trips-empty-add")).toBeTruthy();
  });

  it("lista los viajes declarados", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<MyTripsScreen />);

    expect(getByTestId(`my-trips-card-${TRIP_A.id}`)).toBeTruthy();
  });

  it("AC2/AC4: un viaje con paquetes aceptados no expone editar/eliminar", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_BLOCKED], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { queryByTestId, getByTestId } = await render(<MyTripsScreen />);

    expect(getByTestId(`my-trips-card-${TRIP_BLOCKED.id}-accepted-badge`)).toBeTruthy();
    expect(queryByTestId(`my-trips-card-${TRIP_BLOCKED.id}-edit`)).toBeNull();
    expect(queryByTestId(`my-trips-card-${TRIP_BLOCKED.id}-delete`)).toBeNull();
  });

  it("hallazgo de review (PR #120): un viaje cancelado (sin paquetes aceptados) tampoco expone editar/eliminar", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_CANCELLED], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<MyTripsScreen />);

    expect(queryByTestId(`my-trips-card-${TRIP_CANCELLED.id}-edit`)).toBeNull();
    expect(queryByTestId(`my-trips-card-${TRIP_CANCELLED.id}-delete`)).toBeNull();
  });

  it("navega a editar al tocar el ícono de lápiz de un viaje sin paquetes aceptados", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId(`my-trips-card-${TRIP_A.id}-edit`));

    expect(mockRouterPush).toHaveBeenCalledWith(`/carrier/trips/${TRIP_A.id}/edit`);
  });

  it("pide confirmación antes de cancelar y ejecuta la mutación al confirmar", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const confirm = buttons?.find((b) => b.style === "destructive");
      confirm?.onPress?.();
    });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId(`my-trips-card-${TRIP_A.id}-delete`));

    expect(alertSpy).toHaveBeenCalled();
    expect(mockDeleteMutate).toHaveBeenCalledWith(TRIP_A.id, expect.objectContaining({ onError: expect.any(Function) }));
    alertSpy.mockRestore();
  });

  it("hallazgo de review (PR #120): muestra un Alert de error si la mutación de cancelar falla", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockDeleteMutate.mockImplementation((_id: string, { onError }: any) =>
      onError(new Error("network error")),
    );
    const confirmAlertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementationOnce((_t, _m, buttons) => {
        const confirm = buttons?.find((b) => b.style === "destructive");
        confirm?.onPress?.();
      });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId(`my-trips-card-${TRIP_A.id}-delete`));

    expect(confirmAlertSpy).toHaveBeenCalledWith(
      "Error",
      "No pudimos cancelar el viaje. Probá de nuevo.",
    );
    confirmAlertSpy.mockRestore();
  });

  it("no cancela si se descarta la confirmación", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      const cancel = buttons?.find((b) => b.style === "cancel");
      cancel?.onPress?.();
    });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId(`my-trips-card-${TRIP_A.id}-delete`));

    expect(mockDeleteMutate).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("navega a declarar viaje desde el botón al pie", async () => {
    mockUseMyTrips.mockReturnValue({
      data: { items: [TRIP_A], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId("my-trips-add"));

    expect(mockRouterPush).toHaveBeenCalledWith("/carrier/trips/new");
  });

  it("vuelve atrás al tocar el botón de back cuando hay historial", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockUseMyTrips.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 }, isLoading: false, isError: false, refetch: jest.fn() });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId("my-trips-back"));

    expect(mockRouterBack).toHaveBeenCalled();
  });

  it("reemplaza a la tab de transportar si no hay historial", async () => {
    mockCanGoBack.mockReturnValue(false);
    mockUseMyTrips.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 }, isLoading: false, isError: false, refetch: jest.fn() });

    const { getByTestId } = await render(<MyTripsScreen />);
    fireEvent.press(getByTestId("my-trips-back"));

    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/(tabs)/transport");
  });
});
