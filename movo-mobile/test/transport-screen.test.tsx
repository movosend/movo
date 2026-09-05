import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { AvailableShipment } from "../src/api/shipments-client";
import TransportScreen from "../app/(app)/(tabs)/transport";

const mockRouterPush = jest.fn();
let mockLocalSearchParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
  useLocalSearchParams: () => mockLocalSearchParams,
}));

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

describe("TransportScreen", () => {
  beforeEach(() => {
    mockLocalSearchParams = {};
    mockUseTransportRadius.mockReturnValue({ radiusKm: 50, setRadiusKm: mockSetRadiusKm });
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
});
