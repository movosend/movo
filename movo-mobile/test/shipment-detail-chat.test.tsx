import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import ShipmentDetailScreen from "../app/(app)/shipments/[id]";

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock("../src/hooks/use-receiver-transfers", () => ({
  useShipmentReceiverTransfers: jest.fn(() => ({ data: [] })),
  useReceiverTransferInvitations: jest.fn(() => ({ data: [] })),
  useCancelReceiverTransfer: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

jest.mock("expo-router", () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({ id: "shipment-1" }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void) => {
    const React = require("react");
    React.useEffect(() => {
      return cb();
    }, [cb]);
  },
}));

const mockUseShipment = jest.fn();
const mockAcceptMutation = { mutateAsync: jest.fn(), isPending: false };
const mockRejectMutation = { mutateAsync: jest.fn(), isPending: false };
const mockCancelMutation = { mutateAsync: jest.fn(), isPending: false };

jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: (...args: unknown[]) => mockUseShipment(...args),
  useShipmentPhotos: () => ({ data: [], isLoading: false, isStale: false, refetch: jest.fn() }),
  useShipmentRoute: () => ({ data: undefined }),
  useShipmentEvents: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
  useAcceptShipment: () => mockAcceptMutation,
  useRejectShipment: () => mockRejectMutation,
  useCancelShipment: () => mockCancelMutation,
}));

jest.mock("../src/hooks/use-offers", () => ({
  useShipmentOffers: () => ({ data: [], isLoading: false }),
}));

jest.mock("../src/hooks/use-ratings", () => ({
  useShipmentRatings: () => ({ data: [], refetch: jest.fn() }),
  useCreateRating: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateRating: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const mockCurrentUser = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: { user: { userId: string } | null }) => unknown) => {
    const state = { user: mockCurrentUser() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

// `RouteMapCard` usa `useFrameCallback` de `react-native-reanimated` para el barrido
// animado — sin mock nativo en este entorno de test (mismo gap que el resto del
// repo, ningún test unitario ejercita ese componente hoy). Se stubea acá: este
// archivo verifica composición/estados de la pantalla, no el render interno del mapa.
const mockRouteMapCard = jest.fn();
jest.mock("../components/send/route-map-card", () => {
  const { View } = require("react-native");
  return {
    RouteMapCard: (props: { testID?: string }) => {
      mockRouteMapCard(props);
      return <View testID={props.testID} />;
    },
  };
});

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (userId: string) => ({
    data: {
      id: userId,
      fullName: userId === "user-1" ? "Pedro Emisor" : "Tomás Olmos",
      photoUrl: null,
      isVerified: true,
      badges: ["kyc_verified"],
      transactionCounts: { asSender: 0, asCarrier: 0 },
      reputationScore: null,
      ratingCount: 0,
      isNewProfile: true,
      asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
      asCarrier: { reputationScore: null, ratingCount: 0, isNewProfile: true },
      recentRatingComments: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "shipment-1",
    senderId: "user-1",
    receiverId: "receiver-1",
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


describe("ShipmentDetailScreen — chat del envío (MOVO-284)", () => {
  beforeEach(() => {
    mockCanGoBack.mockReturnValue(true);
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
  });
  afterEach(() => jest.clearAllMocks());

  function mockShipment(overrides: Partial<ShipmentSummary>) {
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, data: shipment(overrides), error: null, refetch: jest.fn() });
  }

  it.each([
    ShipmentStatus.ASSIGNMENT_PENDING,
    ShipmentStatus.ASSIGNED_UNFUNDED,
    ShipmentStatus.ASSIGNED,
    ShipmentStatus.IN_TRANSIT,
  ])("con transportista (%s) ofrece abrir el chat y navega a la conversación", async (status) => {
    mockShipment({ carrierId: "carrier-1", status });

    const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Coordiná el retiro y la entrega con las otras partes.")).toBeTruthy();
    await fireEvent.press(getByTestId("shipment-detail-chat"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/shipments/shipment-1/chat");
  });

  it("lo ve también el receptor", async () => {
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.ASSIGNED });
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-chat")).toBeTruthy();
  });

  it("lo ve también el transportista", async () => {
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.ASSIGNED });
    mockCurrentUser.mockReturnValue({ userId: "carrier-1" });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-chat")).toBeTruthy();
  });

  it("entregado queda como solo lectura", async () => {
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.DELIVERED });

    const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-chat")).toBeTruthy();
    expect(getByText("El envío finalizó. El chat queda en solo lectura y se archiva en 24 h.")).toBeTruthy();
  });

  it("sin transportista no hay chat", async () => {
    mockShipment({ carrierId: null, status: ShipmentStatus.PUBLISHED });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-chat")).toBeNull();
  });

  it("con el envío cancelado no hay chat", async () => {
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.CANCELLED });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-chat")).toBeNull();
  });

  it("el receptor original lo ve como solo lectura aunque el envío siga en curso", async () => {
    mockCurrentUser.mockReturnValue({ userId: "former-1" });
    mockShipment({
      carrierId: "carrier-1",
      status: ShipmentStatus.IN_TRANSIT,
      receiverTransfer: { viewerIsFormerReceiver: true, pending: null, completed: null },
    });

    const { getByText } = await render(<ShipmentDetailScreen />);

    // Sin entrega: no puede decir que el envío finalizó.
    expect(getByText("Le pasaste la recepción a otra persona. Podés leer la conversación, no escribir.")).toBeTruthy();
  });
});
