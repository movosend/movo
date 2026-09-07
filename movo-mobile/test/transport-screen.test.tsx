import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { AvailableShipment } from "../src/api/shipments-client";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";
import TransportScreen from "../app/(app)/(tabs)/transport";

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
let mockLocalSearchParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
  useLocalSearchParams: () => mockLocalSearchParams,
}));

const mockUseTrip = jest.fn();
const mockUseTripMatches = jest.fn();
jest.mock("../src/hooks/use-trips", () => {
  const actual = jest.requireActual("../src/hooks/use-trips");
  return {
    ...actual,
    useTrip: (...args: unknown[]) => mockUseTrip(...args),
    useTripMatches: (...args: unknown[]) => mockUseTripMatches(...args),
  };
});

const mockUseAvailableShipments = jest.fn();
jest.mock("../src/hooks/use-shipments", () => {
  const actual = jest.requireActual("../src/hooks/use-shipments");
  return {
    ...actual,
    useAvailableShipments: (...args: unknown[]) => mockUseAvailableShipments(...args),
  };
});

const mockUseTransportOrigin = jest.fn();
jest.mock("../src/hooks/use-transport-origin", () => ({
  useTransportOrigin: () => mockUseTransportOrigin(),
}));

const mockSetRadiusKm = jest.fn();
const mockUseTransportRadius = jest.fn();
jest.mock("../src/hooks/use-transport-radius", () => ({
  useTransportRadius: () => mockUseTransportRadius(),
}));

jest.mock("../src/hooks/use-addresses", () => ({
  useAddresses: jest.fn(() => ({ data: [] })),
}));

const mockStubSelection = { address: "Bv. Chacabuco 800, Córdoba", lat: -31.42, lng: -64.18, source: "places" };
jest.mock("../components/send/address-search-sheet", () => {
  const { Pressable, Text } = require("react-native");
  return {
    AddressSearchSheet: ({ visible, onSelect, testID }: any) =>
      visible ? (
        <Pressable testID={`${testID}-stub-select`} onPress={() => onSelect(mockStubSelection)}>
          <Text>stub-address-search-sheet</Text>
        </Pressable>
      ) : null,
  };
});

function availableShipment(overrides: Partial<AvailableShipment> = {}): AvailableShipment {
  return {
    id: "available-1",
    packageType: "standard_package",
    weightKg: 3,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-09-10",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    calculationMethod: "euclidean_linear_v1",
    status: ShipmentStatus.PUBLISHED,
    pickupDistanceKm: 3.2,
    deliveryDistanceKm: null,
    distanceKm: 3.2,
    hasMyOffer: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function pages(items: AvailableShipment[]) {
  return { pages: [{ items, page: 1, limit: 20, total: items.length }] };
}

function baseAvailableResult(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isRefetching: false,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

const RESOLVED_ORIGIN = { lat: -31.4, lng: -64.18, address: "Av. Colón 1234, X5000 Córdoba, Argentina", source: "gps" as const };

function baseOriginResult(overrides: Record<string, unknown> = {}) {
  return {
    origin: RESOLVED_ORIGIN,
    resolving: false,
    needsManualPick: false,
    setManualSelection: jest.fn(),
    ...overrides,
  };
}

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

describe("TransportScreen", () => {
  beforeEach(() => {
    mockLocalSearchParams = {};
    mockUseTransportRadius.mockReturnValue({ radiusKm: 50, setRadiusKm: mockSetRadiusKm });
    // Modo genérico por default — los tests de modo viaje pisan esto con `tripId`.
    mockUseTrip.mockReturnValue({ data: undefined, isLoading: false });
    mockUseTripMatches.mockReturnValue(baseAvailableResult());
  });

  afterEach(() => jest.clearAllMocks());

  it("navega a 'Mis viajes' al tocar el botón del header (MOVO-162)", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));

    const { getByTestId } = await render(<TransportScreen />);

    fireEvent.press(getByTestId("transport-my-trips-cta"));

    expect(mockRouterPush).toHaveBeenCalledWith("/carrier/trips");
  });

  it("lista los envíos disponibles", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

    const { getByTestId } = await render(<TransportScreen />);

    expect(getByTestId("transport-card-available-1")).toBeTruthy();
  });

  it("muestra el estado vacío con acción de ampliar el radio", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));

    const { getByText, getByTestId } = await render(<TransportScreen />);

    expect(getByText("No hay envíos disponibles en este radio.")).toBeTruthy();
    expect(getByTestId("transport-expand-radius")).toBeTruthy();
  });

  it("no ofrece ampliar el radio si ya está en el máximo", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseTransportRadius.mockReturnValue({ radiusKm: 100, setRadiusKm: mockSetRadiusKm });
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));

    const { queryByTestId } = await render(<TransportScreen />);

    expect(queryByTestId("transport-expand-radius")).toBeNull();
  });

  it("sin GPS ni dirección default, abre el selector manual de ubicación", async () => {
    const originResult = baseOriginResult({ origin: null, needsManualPick: true });
    mockUseTransportOrigin.mockReturnValue(originResult);
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult());

    const { getByTestId } = await render(<TransportScreen />);

    const stubSelect = getByTestId("transport-address-picker-stub-select");
    expect(stubSelect).toBeTruthy();

    await fireEvent.press(stubSelect);
    expect(originResult.setManualSelection).toHaveBeenCalledWith(mockStubSelection);
  });

  it("muestra el estado de gating por KYC de identidad, con acción a verificar", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({
        isError: true,
        error: new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás tu identidad verificada."),
      }),
    );

    const { getByText, getByTestId } = await render(<TransportScreen />);

    expect(getByText("Verificá tu identidad para transportar")).toBeTruthy();

    await fireEvent.press(getByTestId("transport-verify-kyc"));
    expect(mockRouterPush).toHaveBeenCalledWith("/kyc");
  });

  it("un error que no es de gating muestra el ErrorBanner con el mensaje de error-messages.ts", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({ isError: true, error: new ApiError(500, "INTERNAL_ERROR", "boom") }),
    );

    const { getByTestId, getByText, queryByText } = await render(<TransportScreen />);

    expect(getByTestId("transport-list-error")).toBeTruthy();
    expect(getByText("Ocurrió un error inesperado. Intentá de nuevo en unos minutos.")).toBeTruthy();
    expect(queryByText("Verificá tu identidad para transportar")).toBeNull();
  });

  it("un error sin código mapeado en error-messages.ts cae al mensaje genérico del listado", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({ isError: true, error: new Error("network down") }),
    );

    const { getByText } = await render(<TransportScreen />);

    expect(getByText("No pudimos cargar los envíos disponibles.")).toBeTruthy();
  });

  it("oculta un envío cuya ventana de retiro ya venció (el backend no lo filtra)", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({
        data: pages([
          availableShipment({ id: "vencido", pickupDate: "2020-01-01", pickupTimeWindowEnd: "12:00" }),
          availableShipment({ id: "vigente" }),
        ]),
      }),
    );

    const { getByTestId, queryByTestId } = await render(<TransportScreen />);

    expect(getByTestId("transport-card-vigente")).toBeTruthy();
    expect(queryByTestId("transport-card-vencido")).toBeNull();
  });

  it("una página entera vencida con más páginas disponibles cascadea a la próxima en vez de mostrar el estado vacío", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    const fetchNextPage = jest.fn();
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({
        data: pages([availableShipment({ id: "vencido", pickupDate: "2020-01-01", pickupTimeWindowEnd: "12:00" })]),
        hasNextPage: true,
        fetchNextPage,
      }),
    );

    const { queryByText } = await render(<TransportScreen />);

    expect(fetchNextPage).toHaveBeenCalled();
    expect(queryByText("No hay envíos disponibles en este radio.")).toBeNull();
  });

  it("una página entera vencida sin más páginas disponibles cae al estado vacío, sin cascadear", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    const fetchNextPage = jest.fn();
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({
        data: pages([availableShipment({ id: "vencido", pickupDate: "2020-01-01", pickupTimeWindowEnd: "12:00" })]),
        hasNextPage: false,
        fetchNextPage,
      }),
    );

    const { getByText } = await render(<TransportScreen />);

    expect(fetchNextPage).not.toHaveBeenCalled();
    expect(getByText("No hay envíos disponibles en este radio.")).toBeTruthy();
  });

  it("marca los envíos donde ya ofertó sin ocultarlos", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({ data: pages([availableShipment({ id: "offered-1", hasMyOffer: true })]) }),
    );

    const { getByTestId } = await render(<TransportScreen />);

    expect(getByTestId("transport-card-offered-1")).toBeTruthy();
    expect(getByTestId("transport-card-offered-1-has-offer")).toBeTruthy();
  });

  it("con origen de dirección guardada, la zona sale del campo city, no del label de la dirección", async () => {
    mockUseTransportOrigin.mockReturnValue(
      baseOriginResult({
        origin: { lat: -31.42, lng: -64.2, address: "Juan Del Campillo 367", source: "saved", city: "Córdoba" },
      }),
    );
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

    const { getByText, queryByText } = await render(<TransportScreen />);

    expect(getByText("Envíos cerca de Córdoba")).toBeTruthy();
    expect(queryByText("Envíos cerca de Juan Del Campillo 367")).toBeNull();
  });

  it("cambiar el radio dispara una nueva consulta con el radio nuevo", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

    const { getByTestId } = await render(<TransportScreen />);

    await fireEvent.press(getByTestId("transport-radius-100"));

    expect(mockSetRadiusKm).toHaveBeenCalledWith(100);
  });

  it("muestra el banner de confirmación cuando vuelve con offerCreated=1 (MOVO-149)", async () => {
    mockLocalSearchParams = { offerCreated: "1" };
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

    const { getByTestId } = await render(<TransportScreen />);

    expect(getByTestId("transport-offer-created-success")).toBeTruthy();
    expect(getByTestId("transport-offer-created-success")).toHaveTextContent(
      "¡Oferta enviada! Ya podés verla reflejada en el envío."
    );
  });

  describe("modo filtrado por viaje (MOVO-163, ?tripId=)", () => {
    beforeEach(() => {
      mockLocalSearchParams = { tripId: TRIP_A.id };
      // El origen/GPS no aplica en modo viaje — `useTransportOrigin` sigue mockeado
      // (jest.mock ignora el argumento `enabled`), se lo deja en su default neutro.
      mockUseTransportOrigin.mockReturnValue(baseOriginResult({ origin: null, resolving: false, needsManualPick: false }));
    });

    it("usa GET /trips/:id/matches como fuente y muestra el header de filtro (AC1/AC2)", async () => {
      mockUseTrip.mockReturnValue({ data: TRIP_A, isLoading: false });
      mockUseTripMatches.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

      const { getByTestId, getByText } = await render(<TransportScreen />);

      expect(getByText("Filtrado por viaje: Av. Colón 1234 → Av. San Martín 100")).toBeTruthy();
      expect(getByTestId("transport-card-available-1")).toBeTruthy();
    });

    it("estado vacío específico: 'Ningún paquete compatible con este viaje todavía' (AC4)", async () => {
      mockUseTrip.mockReturnValue({ data: TRIP_A, isLoading: false });
      mockUseTripMatches.mockReturnValue(baseAvailableResult({ data: pages([]) }));

      const { getByText, queryByTestId } = await render(<TransportScreen />);

      expect(getByText("Ningún paquete compatible con este viaje todavía.")).toBeTruthy();
      // Sin selector de radio en este modo, "ampliar radio" no aplica acá.
      expect(queryByTestId("transport-expand-radius")).toBeNull();
    });

    it("'Ver todos' vuelve al feed genérico sin el filtro", async () => {
      mockUseTrip.mockReturnValue({ data: TRIP_A, isLoading: false });
      mockUseTripMatches.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

      const { getByTestId } = await render(<TransportScreen />);
      fireEvent.press(getByTestId("transport-clear-trip-filter"));

      expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/(tabs)/transport");
    });

    it("gating por KYC de identidad también aplica al error de matches", async () => {
      mockUseTrip.mockReturnValue({ data: TRIP_A, isLoading: false });
      mockUseTripMatches.mockReturnValue(
        baseAvailableResult({
          isError: true,
          error: new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás tu identidad verificada."),
        }),
      );

      const { getByText } = await render(<TransportScreen />);

      expect(getByText("Verificá tu identidad para transportar")).toBeTruthy();
    });

    it("muestra error con reintentar si falla useTrip, sin depender de useTripMatches (AC2)", async () => {
      const refetchTrip = jest.fn();
      mockUseTrip.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: new ApiError(404, "TRIP_NOT_FOUND", "Este viaje no existe."),
        refetch: refetchTrip,
      });
      mockUseTripMatches.mockReturnValue(baseAvailableResult({ data: pages([]) }));

      const { getByTestId, getByText } = await render(<TransportScreen />);

      expect(getByTestId("transport-trip-error")).toBeTruthy();
      fireEvent.press(getByText("Reintentar"));
      expect(refetchTrip).toHaveBeenCalledTimes(1);
    });

    it("sin radio/origen ni selector manual en este modo", async () => {
      mockUseTrip.mockReturnValue({ data: TRIP_A, isLoading: false });
      mockUseTripMatches.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

      const { queryByTestId } = await render(<TransportScreen />);

      expect(queryByTestId("transport-radius-50")).toBeNull();
      expect(queryByTestId("transport-zone-label")).toBeNull();
    });
  });
});
