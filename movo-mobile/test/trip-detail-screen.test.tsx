import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import TripDetailScreen from "../app/(app)/carrier/trips/[id]/index";
import { TripStatus, type TripAcceptedPackage, type TripWithAcceptedPackages } from "../src/api/trips-client";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    back: () => mockBack(),
    replace: (...a: unknown[]) => mockReplace(...a),
    dismissTo: (...a: unknown[]) => mockDismissTo(...a),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({ id: "trip-1" }),
}));

const mockUseTrip = jest.fn();
const mockCancelMutate = jest.fn();
const mockStartMutateAsync = jest.fn();
jest.mock("../src/hooks/use-trips", () => ({
  useTrip: (id: string) => mockUseTrip(id),
  useCancelTrip: () => ({ mutate: mockCancelMutate, isPending: false }),
  useStartTrip: () => ({ mutateAsync: mockStartMutateAsync, isPending: false }),
}));

// El mapa real pide la ruta (TanStack Query) y usa react-native-maps; acá solo interesa que se monte.
jest.mock("../components/trips/trip-detail-map", () => {
  const { View } = require("react-native");
  return { TripDetailMap: () => <View testID="trip-detail-map" /> };
});

const TRIP: TripWithAcceptedPackages = {
  id: "trip-1",
  carrierId: "carrier-1",
  originAddress: "Av. Colón 1250, Córdoba Centro",
  originLat: -31.42,
  originLng: -64.19,
  destinationAddress: "Bv. España 300, Villa María",
  destinationLat: -32.41,
  destinationLng: -63.24,
  departureAt: "2026-10-02T11:00:00.000Z",
  vehicleType: "Fiat Fiorino",
  status: TripStatus.DECLARED,
  createdAt: "2026-09-20T12:00:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
  cancelledAt: null,
  hasAcceptedPackages: false,
  acceptedPackagesCount: 0,
  packages: [],
};

const pkg = (id: string, price: number): TripAcceptedPackage => ({
  shipmentId: id,
  status: ShipmentStatus.ASSIGNED,
  packageType: "standard_package",
  weightKg: 2,
  pickupAddress: "Nueva Córdoba, Córdoba",
  pickupLat: -31.42,
  pickupLng: -64.18,
  deliveryAddress: "Villa María",
  deliveryLat: -32.4,
  deliveryLng: -63.24,
  pickupDate: "2026-10-02",
  pickupTimeWindowStart: "07:00:00",
  pickupTimeWindowEnd: "09:00:00",
  agreedPriceArs: price,
  senderName: "Julia Paz",
});

const WITH_PACKAGES: TripWithAcceptedPackages = {
  ...TRIP,
  hasAcceptedPackages: true,
  acceptedPackagesCount: 2,
  packages: [pkg("ship-1", 12400), pkg("ship-2", 6800)],
};

const loaded = (data: TripWithAcceptedPackages, extra: object = {}) => ({
  data,
  isLoading: false,
  isError: false,
  isRefetching: false,
  refetch: jest.fn(),
  ...extra,
});

describe("TripDetailScreen (MOVO-263)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(true);
  });

  it("muestra skeleton mientras carga", async () => {
    mockUseTrip.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { getByTestId } = await render(<TripDetailScreen />);
    expect(getByTestId("trip-detail-skeleton")).toBeTruthy();
  });

  it.each([
    [403, "Este viaje no te pertenece."],
    [404, "Este viaje no existe."],
  ])("error %s con copy propio y reintento", async (statusCode, message) => {
    const refetch = jest.fn();
    mockUseTrip.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(statusCode, "TRIP_NOT_FOUND", "x"),
      refetch,
    });
    const { getByText, getByTestId } = await render(<TripDetailScreen />);

    expect(getByText(message)).toBeTruthy();
    await fireEvent.press(getByTestId("trip-detail-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("AC1: muestra mapa, estado, recorrido completo, salida y vehículo", async () => {
    mockUseTrip.mockReturnValue(loaded(TRIP));
    const { getByTestId, getByText } = await render(<TripDetailScreen />);

    expect(getByTestId("trip-detail-map")).toBeTruthy();
    expect(getByText("Declarado")).toBeTruthy();
    expect(getByText("Av. Colón 1250, Córdoba Centro")).toBeTruthy();
    expect(getByText("Bv. España 300, Villa María")).toBeTruthy();
    expect(getByText("Fiat Fiorino")).toBeTruthy();
    expect(getByText(/Octubre|octubre/)).toBeTruthy();
  });

  it("AC3/AC5: declared sin paquetes → estado vacío con buscar, editar y cancelar", async () => {
    mockUseTrip.mockReturnValue(loaded(TRIP));
    const { getByTestId, getByText, queryByTestId } = await render(<TripDetailScreen />);

    expect(getByText("Todavía no tenés paquetes para este viaje")).toBeTruthy();
    expect(getByTestId("trip-detail-edit")).toBeTruthy();
    expect(getByTestId("trip-detail-cancel")).toBeTruthy();
    expect(queryByTestId("trip-detail-start")).toBeNull();
    expect(queryByTestId("trip-detail-locked-note")).toBeNull();

    await fireEvent.press(getByTestId("trip-detail-edit"));
    expect(mockPush).toHaveBeenCalledWith("/carrier/trips/trip-1/edit");
  });

  it("AC4: el CTA de buscar navega al feed filtrado con tripId", async () => {
    mockUseTrip.mockReturnValue(loaded(TRIP));
    const { getByTestId } = await render(<TripDetailScreen />);

    await fireEvent.press(getByTestId("trip-detail-search-empty"));

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/(app)/(tabs)/transport", params: { tripId: "trip-1" } });
  });

  it("AC2/AC5: con paquetes lista las filas y el total, sin editar/cancelar, con nota y 'Iniciar viaje'", async () => {
    mockUseTrip.mockReturnValue(loaded(WITH_PACKAGES));
    const { getByText, getByTestId, queryByTestId } = await render(<TripDetailScreen />);

    expect(getByText("Paquetes aceptados (2)")).toBeTruthy();
    expect(getByTestId("trip-detail-package-ship-1")).toBeTruthy();
    expect(getByTestId("trip-detail-package-ship-2")).toBeTruthy();
    expect(getByTestId("trip-detail-total")).toBeTruthy();
    expect(getByTestId("trip-detail-locked-note")).toBeTruthy();
    expect(getByTestId("trip-detail-start")).toBeTruthy();
    expect(queryByTestId("trip-detail-edit")).toBeNull();
    expect(queryByTestId("trip-detail-cancel")).toBeNull();
  });

  it("AC2: tocar un paquete abre el detalle del envío", async () => {
    mockUseTrip.mockReturnValue(loaded(WITH_PACKAGES));
    const { getByTestId } = await render(<TripDetailScreen />);

    await fireEvent.press(getByTestId("trip-detail-package-ship-1"));

    expect(mockPush).toHaveBeenCalledWith("/shipments/ship-1");
  });

  it("AC4: 'Buscar más paquetes' aparece con el viaje declarado y navega con tripId", async () => {
    mockUseTrip.mockReturnValue(loaded(WITH_PACKAGES));
    const { getByTestId } = await render(<TripDetailScreen />);

    await fireEvent.press(getByTestId("trip-detail-search-more"));

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/(app)/(tabs)/transport", params: { tripId: "trip-1" } });
  });

  it("iniciar viaje llama a la mutación y un error se muestra sin cambiar el estado", async () => {
    mockStartMutateAsync.mockRejectedValueOnce(new ApiError(409, "TRIP_ALREADY_HAS_ACTIVE_TRIP", "x"));
    mockUseTrip.mockReturnValue(loaded(WITH_PACKAGES));
    const { getByTestId } = await render(<TripDetailScreen />);

    await fireEvent.press(getByTestId("trip-detail-start"));

    await waitFor(() => expect(mockStartMutateAsync).toHaveBeenCalledWith("trip-1"));
    await waitFor(() => expect(getByTestId("trip-detail-start-error")).toBeTruthy());
  });

  it("viaje activo: solo 'Ver ruta en vivo', sin buscar/editar/cancelar", async () => {
    mockUseTrip.mockReturnValue(loaded({ ...WITH_PACKAGES, status: TripStatus.ACTIVE }));
    const { getByTestId, queryByTestId } = await render(<TripDetailScreen />);

    expect(queryByTestId("trip-detail-start")).toBeNull();
    expect(queryByTestId("trip-detail-search-more")).toBeNull();
    expect(queryByTestId("trip-detail-locked-note")).toBeNull();
    await fireEvent.press(getByTestId("trip-detail-live-route"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/route", params: { tripId: "trip-1" } });
  });

  it.each([TripStatus.COMPLETED, TripStatus.CANCELLED, TripStatus.EXPIRED])(
    "estado terminal %s: solo lectura, sin acciones",
    async (status) => {
      mockUseTrip.mockReturnValue(loaded({ ...TRIP, status }));
      const { queryByTestId } = await render(<TripDetailScreen />);

      for (const id of [
        "trip-detail-edit",
        "trip-detail-cancel",
        "trip-detail-start",
        "trip-detail-live-route",
        "trip-detail-search-empty",
        "trip-detail-search-more",
      ]) {
        expect(queryByTestId(id)).toBeNull();
      }
    },
  );

  it("AC6: cancelar abre el sheet, confirma y vuelve a Mis viajes con el destino", async () => {
    mockCancelMutate.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    mockUseTrip.mockReturnValue(loaded(TRIP));
    const { getByTestId, getByText } = await render(<TripDetailScreen />);

    await fireEvent.press(getByTestId("trip-detail-cancel"));
    expect(getByText("¿Cancelar el viaje a Bv. España 300?")).toBeTruthy();
    await fireEvent.press(getByTestId("trip-cancel-confirm"));

    expect(mockCancelMutate).toHaveBeenCalledWith("trip-1", expect.any(Object));
    expect(mockDismissTo).toHaveBeenCalledWith({
      pathname: "/carrier/trips",
      params: { cancelledTo: "Bv. España 300" },
    });
  });

  it("AC6: un 409 muestra el motivo en el sheet y refresca el detalle", async () => {
    const refetch = jest.fn();
    mockCancelMutate.mockImplementation((_id: string, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new ApiError(409, "TRIP_HAS_ACCEPTED_PACKAGES", "x")),
    );
    mockUseTrip.mockReturnValue(loaded(TRIP, { refetch }));
    const { getByTestId } = await render(<TripDetailScreen />);

    await fireEvent.press(getByTestId("trip-detail-cancel"));
    await fireEvent.press(getByTestId("trip-cancel-confirm"));

    await waitFor(() => expect(getByTestId("trip-cancel-error")).toBeTruthy());
    expect(refetch).toHaveBeenCalled();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it("volver: back si hay historial, replace a Mis viajes si no", async () => {
    mockUseTrip.mockReturnValue(loaded(TRIP));
    const { getByTestId } = await render(<TripDetailScreen />);

    await fireEvent.press(getByTestId("trip-detail-back"));
    expect(mockBack).toHaveBeenCalled();

    mockCanGoBack.mockReturnValue(false);
    await fireEvent.press(getByTestId("trip-detail-back"));
    expect(mockReplace).toHaveBeenCalledWith("/carrier/trips");
  });
});
