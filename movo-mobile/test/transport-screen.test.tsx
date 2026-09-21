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
const mockUseMyTrips = jest.fn();
jest.mock("../src/hooks/use-trips", () => {
  const actual = jest.requireActual("../src/hooks/use-trips");
  return {
    ...actual,
    useTrip: (...args: unknown[]) => mockUseTrip(...args),
    useTripMatches: (...args: unknown[]) => mockUseTripMatches(...args),
    useMyTrips: (...args: unknown[]) => mockUseMyTrips(...args),
  };
});

const mockUseMyOffers = jest.fn();
jest.mock("../src/hooks/use-offers", () => {
  const actual = jest.requireActual("../src/hooks/use-offers");
  return {
    ...actual,
    useMyOffers: (...args: unknown[]) => mockUseMyOffers(...args),
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

// Bomba de tiempo evitada a propósito: `isPickupWindowExpired` (MOVO-148) filtra
// client-side cualquier envío cuya ventana de retiro ya pasó contra `new Date()`
// real -- una fecha de fixture hardcodeada queda "vencida" tarde o temprano y hace
// fallar la suite sin que nadie haya tocado el código (bug real encontrado en CI: el
// fixture usaba "2026-09-10", que dejó de ser futuro el mismo día que se escribió
// este comentario). `DEFAULT_PICKUP_DATE` siempre es un puñado de días después de
// "hoy" en el momento en que corre el test.
function daysFromNowDateString(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const DEFAULT_PICKUP_DATE = daysFromNowDateString(5);

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
    pickupDate: DEFAULT_PICKUP_DATE,
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

function myOfferSummary(
  overrides: {
    id: string;
    status: "pending" | "accepted" | "rejected" | "withdrawn" | "expired" | "superseded";
  } & Record<string, unknown>,
) {
  return {
    shipmentId: `shipment-${overrides.id}`,
    carrierId: "carrier-1",
    priceOffered: 2400,
    offeredDate: DEFAULT_PICKUP_DATE,
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: null,
    carrierRatingAtOffer: null,
    carrierNameAtOffer: null,
    priceNetArs: 2000,
    commissionAmountArs: 400,
    senderNameAtOffer: null,
    senderVerifiedAtOffer: null,
    senderRatingAtOffer: null,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    viewedAtBySender: null,
    expiresAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    respondedAt: null,
    shipment: {
      id: `shipment-${overrides.id}`,
      status: "assignment_pending",
      pickupAddress: "Paul Dirac 7777, Córdoba",
      pickupDate: DEFAULT_PICKUP_DATE,
      pickupTimeWindowStart: "09:00",
      pickupTimeWindowEnd: "12:00",
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      distanceKm: 3,
      packageType: "standard_package",
      weightKg: 3,
      description: null,
    },
    competitiveRank: null,
    ...overrides,
  };
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
  // Mismo día calendario argentino que DEFAULT_PICKUP_DATE (requisito real de
  // computeOnTripDetour, MOVO-183) -- no un timestamp hardcodeado aparte.
  departureAt: `${DEFAULT_PICKUP_DATE}T12:00:00.000Z`,
  vehicleType: "Auto",
  // MOVO-221: `declared` es el estado real de un viaje recién creado/pendiente de
  // iniciar -- es el que alimenta tripsMeta/computeOnTripDetour ahora, no `active`.
  status: TripStatus.DECLARED,
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
    // Sin viajes/ofertas por default — sin esto no hay "on-trip" que mergear ni
    // contadores que mostrar en los accesos (MOVO-183).
    mockUseMyTrips.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 } });
    mockUseMyOffers.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 } });
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

    expect(getByText("Todo tranquilo en 50 km")).toBeTruthy();
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
    expect(queryByText("Todo tranquilo en 50 km")).toBeNull();
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
    expect(getByText("Todo tranquilo en 50 km")).toBeTruthy();
  });

  it("un envío ya ofertado se muestra con el precio de la oferta (gris) e indicador de estado, no el sugerido", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({ data: pages([availableShipment({ id: "offered-1", hasMyOffer: true })]) }),
    );
    mockUseMyOffers.mockReturnValue({
      data: {
        items: [myOfferSummary({ id: "o1", status: "pending", shipmentId: "offered-1", priceOffered: 3100 })],
        page: 1,
        limit: 50,
        total: 1,
      },
    });

    const { getByTestId } = await render(<TransportScreen />);

    expect(getByTestId("transport-card-offered-1")).toBeTruthy();
    expect(getByTestId("transport-card-offered-1-my-offer-price")).toHaveTextContent("$3.100tu oferta");
    expect(getByTestId("transport-card-offered-1-offer-status")).toHaveTextContent("Pendiente");
  });

  it("bug real: una oferta retirada del historial no se muestra como si siguiera vigente", async () => {
    // `hasMyOffer` (calculado por el backend) es `false` acá -- ya no hay ninguna
    // oferta activa sobre este envío -- pero `GET /offers/mine` sigue devolviendo la
    // retirada en el historial. El envío debería verse como cualquier otro disponible,
    // sin el pill gris ni el chip de estado.
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(
      baseAvailableResult({ data: pages([availableShipment({ id: "shipment-1", hasMyOffer: false })]) }),
    );
    mockUseMyOffers.mockReturnValue({
      data: {
        items: [myOfferSummary({ id: "o1", status: "withdrawn", shipmentId: "shipment-1" })],
        page: 1,
        limit: 50,
        total: 1,
      },
    });

    const { getByTestId, queryByTestId } = await render(<TransportScreen />);

    expect(getByTestId("transport-card-shipment-1")).toBeTruthy();
    expect(queryByTestId("transport-card-shipment-1-my-offer-price")).toBeNull();
    expect(queryByTestId("transport-card-shipment-1-offer-status")).toBeNull();
  });

  it("con origen de dirección guardada, la zona sale del campo city, no del label de la dirección", async () => {
    mockUseTransportOrigin.mockReturnValue(
      baseOriginResult({
        origin: { lat: -31.42, lng: -64.2, address: "Juan Del Campillo 367", source: "saved", city: "Córdoba" },
      }),
    );
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

    const { getByText, queryByText } = await render(<TransportScreen />);

    expect(getByText("Córdoba")).toBeTruthy();
    expect(queryByText("Juan Del Campillo 367")).toBeNull();
  });

  it("cambiar el radio dispara una nueva consulta con el radio nuevo", async () => {
    mockUseTransportOrigin.mockReturnValue(baseOriginResult());
    mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([availableShipment()]) }));

    const { getByTestId } = await render(<TransportScreen />);

    await fireEvent.press(getByTestId("transport-radius-100"));

    expect(mockSetRadiusKm).toHaveBeenCalledWith(100);
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
      expect(queryByTestId("transport-zone-chip")).toBeNull();
    });
  });

  describe("rediseño MOVO-183", () => {
    it("muestra los accesos con contador de Mis viajes y Mis ofertas", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));
      mockUseMyTrips.mockReturnValue({
        data: { items: [TRIP_A, { ...TRIP_A, id: "trip-2", status: TripStatus.COMPLETED }], page: 1, limit: 50, total: 2 },
      });
      mockUseMyOffers.mockReturnValue({
        data: {
          items: [myOfferSummary({ id: "o1", status: "pending" }), myOfferSummary({ id: "o2", status: "accepted" })],
          page: 1,
          limit: 50,
          total: 2,
        },
      });

      const { getByText, getByTestId } = await render(<TransportScreen />);

      // MOVO-221: solo cuenta declared (TRIP_A) -- el segundo (completed) no.
      expect(getByText("1 declarado")).toBeTruthy();
      expect(getByText("1 pendiente · 1 aceptada")).toBeTruthy();
      // Punto de atención (lime) solo cuando hay al menos una oferta aceptada.
      expect(getByTestId("transport-my-offers-attention-dot")).toBeTruthy();
    });

    it("MOVO-221: un viaje active tampoco cuenta en tripsMeta -- solo declared", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));
      mockUseMyTrips.mockReturnValue({
        data: { items: [{ ...TRIP_A, status: TripStatus.ACTIVE }], page: 1, limit: 50, total: 1 },
      });
      mockUseMyOffers.mockReturnValue({ data: { items: [], page: 1, limit: 50, total: 0 } });

      const { getByText } = await render(<TransportScreen />);

      expect(getByText("0 declarados")).toBeTruthy();
    });

    it("el acceso 'Mis ofertas' navega a /carrier/offers", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));

      const { getByTestId } = await render(<TransportScreen />);

      fireEvent.press(getByTestId("transport-my-offers-cta"));

      expect(mockRouterPush).toHaveBeenCalledWith("/carrier/offers");
    });

    it("el chip de zona abre el mismo selector de dirección que antes usaba 'Cambiar'", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));

      const { getByTestId } = await render(<TransportScreen />);

      await fireEvent.press(getByTestId("transport-zone-chip"));

      expect(getByTestId("transport-address-picker-stub-select")).toBeTruthy();
    });

    it("filtra por tipo de paquete desde la hoja de filtros", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(
        baseAvailableResult({
          data: pages([
            availableShipment({ id: "doc", packageType: "letter_document" }),
            availableShipment({ id: "std", packageType: "standard_package" }),
          ]),
        }),
      );

      const { getByTestId, queryByTestId } = await render(<TransportScreen />);

      expect(getByTestId("transport-card-doc")).toBeTruthy();
      expect(getByTestId("transport-card-std")).toBeTruthy();

      await fireEvent.press(getByTestId("transport-open-filters"));
      await fireEvent.press(getByTestId("transport-filters-type-letter_document"));
      await fireEvent.press(getByTestId("transport-filters-apply"));

      expect(getByTestId("transport-card-doc")).toBeTruthy();
      expect(queryByTestId("transport-card-std")).toBeNull();
      expect(getByTestId("transport-filter-count-badge")).toBeTruthy();
    });

    it("los envíos ya ofertados quedan en la misma lista, siempre al final", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(
        baseAvailableResult({
          data: pages([
            availableShipment({ id: "offered", hasMyOffer: true }),
            availableShipment({ id: "not-offered", hasMyOffer: false }),
          ]),
        }),
      );

      const { getByTestId, queryByTestId, getAllByTestId } = await render(<TransportScreen />);

      expect(getByTestId("transport-card-offered")).toBeTruthy();
      expect(getByTestId("transport-card-not-offered")).toBeTruthy();
      // "not-offered" primero pese a que "offered" fue el primero en la respuesta del
      // servidor -- el ítem con oferta propia siempre se manda al final del orden.
      const testIds = getAllByTestId(/^transport-card-(offered|not-offered)$/).map((el) => el.props.testID);
      expect(testIds).toEqual(["transport-card-not-offered", "transport-card-offered"]);
      expect(queryByTestId("transport-card-offered-my-offer-price")).toBeNull();
    });

    it("fusiona el desvío de un viaje declared en la card (aproximación client-side, MOVO-221)", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      // Envío cuyo retiro está prácticamente sobre el origen del viaje declarado —
      // desvío ~0, bien por debajo de ON_TRIP_MAX_DETOUR_KM.
      mockUseAvailableShipments.mockReturnValue(
        baseAvailableResult({
          data: pages([availableShipment({ id: "on-trip", pickupLat: TRIP_A.originLat, pickupLng: TRIP_A.originLng })]),
        }),
      );
      mockUseMyTrips.mockReturnValue({ data: { items: [TRIP_A], page: 1, limit: 50, total: 1 } });

      const { getByTestId } = await render(<TransportScreen />);

      expect(getByTestId("transport-card-on-trip-detour")).toBeTruthy();
    });

    it("MOVO-221: un viaje ya active (no declared) no aporta la franja de desvío", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(
        baseAvailableResult({
          data: pages([availableShipment({ id: "on-trip", pickupLat: TRIP_A.originLat, pickupLng: TRIP_A.originLng })]),
        }),
      );
      mockUseMyTrips.mockReturnValue({
        data: { items: [{ ...TRIP_A, status: TripStatus.ACTIVE }], page: 1, limit: 50, total: 1 },
      });

      const { queryByTestId, getByTestId } = await render(<TransportScreen />);

      expect(getByTestId("transport-card-on-trip")).toBeTruthy();
      expect(queryByTestId("transport-card-on-trip-detour")).toBeNull();
    });

    it("muestra el conteo de resultados y ordena por desvío/pago/próximo al ciclar", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(
        baseAvailableResult({
          data: pages([
            availableShipment({ id: "cheap", suggestedPriceArs: 1000, pickupDate: daysFromNowDateString(14) }),
            availableShipment({ id: "pricey", suggestedPriceArs: 9000, pickupDate: daysFromNowDateString(3) }),
          ]),
        }),
      );

      const { getByText, getByTestId } = await render(<TransportScreen />);

      expect(getByText("2 envíos en 50 km")).toBeTruthy();
      expect(getByText("Menos desvío")).toBeTruthy();

      await fireEvent.press(getByTestId("transport-sort-cycle"));
      expect(getByText("Mejor pago")).toBeTruthy();

      await fireEvent.press(getByTestId("transport-sort-cycle"));
      expect(getByText("Más próximo")).toBeTruthy();

      await fireEvent.press(getByTestId("transport-sort-cycle"));
      expect(getByText("Menos desvío")).toBeTruthy();
    });

    it("sin resultados, no muestra la fila de conteo/orden", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(baseAvailableResult({ data: pages([]) }));

      const { queryByTestId } = await render(<TransportScreen />);

      expect(queryByTestId("transport-results-label")).toBeNull();
    });

    it("estado vacío con filtros: copy y botón 'Limpiar filtros'", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(
        baseAvailableResult({ data: pages([availableShipment({ id: "std", packageType: "standard_package" })]) }),
      );

      const { getByTestId, getByText } = await render(<TransportScreen />);

      await fireEvent.press(getByTestId("transport-open-filters"));
      await fireEvent.press(getByTestId("transport-filters-type-letter_document"));
      await fireEvent.press(getByTestId("transport-filters-apply"));

      expect(getByText("Nada con estos filtros")).toBeTruthy();
      expect(getByText("Con los filtros que pusiste no hay nada. Probá sacando alguno o mirá más lejos.")).toBeTruthy();

      await fireEvent.press(getByTestId("transport-clear-filters"));
      expect(getByTestId("transport-card-std")).toBeTruthy();
    });

    it("el acceso 'Mi ruta de hoy' navega a /route (MOVO-207)", async () => {
      mockUseTransportOrigin.mockReturnValue(baseOriginResult());
      mockUseAvailableShipments.mockReturnValue(baseAvailableResult());

      const { getByTestId } = await render(<TransportScreen />);

      await fireEvent.press(getByTestId("transport-my-route-cta"));

      expect(mockRouterPush).toHaveBeenCalledWith("/route");
    });
  });
});
