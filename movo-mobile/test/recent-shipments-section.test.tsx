import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import { TripStatus, type TripWithAcceptedPackages } from "../src/api/trips-client";
import { RecentShipmentsSection } from "../components/home/recent-shipments-section";

const mockRouterPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const mockUseRecentShipments = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useRecentShipments: () => mockUseRecentShipments(),
}));

const mockUseMyTrips = jest.fn(() => ({ data: { items: [] as unknown[], total: 0 } }));
jest.mock("../src/hooks/use-trips", () => ({
  useMyTrips: () => mockUseMyTrips(),
}));

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (userId: string) => ({
    data: {
      id: userId,
      fullName: userId === "user-1" ? "Pedro Emisor" : "Tomás Olmos",
      photoUrl: null,
      isVerified: true,
      badges: [],
      transactionCounts: { asSender: 0, asCarrier: 0 },
      reputationScore: null,
    },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: { user: { userId: string } | null }) => unknown) => {
    const state = { user: { userId: "user-1" } };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "shipment-1",
    senderId: "user-1",
    receiverId: "user-2",
    carrierId: null,
    packageType: "standard_package",
    weightKg: 2,
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
    pickupDate: "2026-08-20",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    highDemand: null,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.PUBLISHED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

// MOVO-83: sección "Actividad reciente" de Inicio, vista previa de GET /shipments/mine.
describe("RecentShipmentsSection", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra un indicador de carga mientras el fetch está pendiente", async () => {
    mockUseRecentShipments.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: jest.fn() });

    const { getByTestId, queryByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByTestId("section")).toBeTruthy();
    expect(queryByText("Todavía no hiciste ningún envío.")).toBeNull();
  });

  it("muestra el estado de error ante un fallo de red", async () => {
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByText("No pudimos cargar tus envíos.")).toBeTruthy();
  });

  it("muestra el estado vacío cuando no hay envíos todavía", async () => {
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [], page: 1, limit: 3, total: 0 },
      refetch: jest.fn(),
    });

    const { getByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByText("Todavía no hiciste ningún envío.")).toBeTruthy();
  });

  it("lista los envíos recientes con su destinatario/remitente y estado", async () => {
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        items: [
          shipment({
            id: "s1",
            status: ShipmentStatus.IN_TRANSIT,
            senderId: "user-1",
            receiverId: "user-2",
          }),
        ],
        page: 1,
        limit: 3,
        total: 1,
      },
      refetch: jest.fn(),
    });

    const { getByText } = await render(<RecentShipmentsSection testID="section" />);

    expect(getByText("Envío a Tomás")).toBeTruthy();
    expect(getByText("En camino")).toBeTruthy();
  });

  it("navega al detalle del envío al tocar una fila (MOVO-127)", async () => {
    mockUseRecentShipments.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [shipment({ id: "s1" })], page: 1, limit: 3, total: 1 },
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<RecentShipmentsSection testID="section" />);

    await fireEvent.press(getByTestId("shipment-row-s1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/s1");
  });

  describe("viajes del transportista", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const trip = (id: string, offsetDays: number, updatedAt: string): TripWithAcceptedPackages => ({
      id,
      carrierId: "user-1",
      originAddress: "Av. Colón 100, Córdoba",
      originLat: -31.4,
      originLng: -64.18,
      destinationAddress: "Bv. Oroño 50, Rosario",
      destinationLat: -32.95,
      destinationLng: -60.65,
      departureAt: new Date(Date.now() + offsetDays * DAY_MS).toISOString(),
      vehicleType: "Auto",
      status: TripStatus.DECLARED,
      createdAt: updatedAt,
      updatedAt,
      cancelledAt: null,
      hasAcceptedPackages: true,
      acceptedPackagesCount: 2,
    });

    it("lista los declared que no van en la card de Estoy transportando, con su estado real, mezclados por actividad", async () => {
      mockUseRecentShipments.mockReturnValue({
        isLoading: false,
        isError: false,
        data: { items: [shipment({ id: "s1", createdAt: "2026-09-20T10:00:00.000Z" })], page: 1, limit: 3, total: 1 },
        refetch: jest.fn(),
      });
      mockUseMyTrips.mockReturnValue({
        data: {
          items: [
            trip("t-today", 0, "2026-09-25T10:00:00.000Z"),
            trip("t-past", -7, "2026-09-22T10:00:00.000Z"),
          ],
          total: 2,
        },
      });

      const { getByTestId, queryByTestId, getByText, getAllByTestId } = await render(
        <RecentShipmentsSection testID="section" />,
      );

      // El de hoy va a la card de "Estoy transportando", no se repite acá.
      expect(queryByTestId("trip-row-t-today")).toBeNull();
      expect(getByTestId("trip-row-t-past")).toBeTruthy();
      expect(getByText("Córdoba → Rosario")).toBeTruthy();
      expect(getByText("Declarado")).toBeTruthy();
      expect(getAllByTestId(/^(trip|shipment)-row-/).map((n) => n.props.testID)).toEqual([
        "trip-row-t-past",
        "shipment-row-s1",
      ]);

      fireEvent.press(getByTestId("trip-row-t-past"));
      expect(mockRouterPush).toHaveBeenCalledWith({ pathname: "/route", params: { tripId: "t-past" } });
    });

    it("con viajes pero sin envíos no muestra el estado vacío", async () => {
      mockUseRecentShipments.mockReturnValue({
        isLoading: false,
        isError: false,
        data: { items: [], page: 1, limit: 3, total: 0 },
        refetch: jest.fn(),
      });
      mockUseMyTrips.mockReturnValue({
        data: { items: [trip("t-future", 3, "2026-09-25T10:00:00.000Z")], total: 1 },
      });

      const { getByTestId, queryByText } = await render(<RecentShipmentsSection testID="section" />);

      expect(getByTestId("trip-row-t-future")).toBeTruthy();
      expect(queryByText("Todavía no hiciste ningún envío.")).toBeNull();
    });
  });
});
