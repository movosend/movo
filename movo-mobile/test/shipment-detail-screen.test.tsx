import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { RefreshControl } from "react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import ShipmentDetailScreen from "../app/(app)/shipments/[id]";
import { useCancelReceiverTransfer } from "../src/hooks/use-receiver-transfers";

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn();

// MOVO-300: sin suspensión; el caso suspendido tiene sus propios tests.
jest.mock("../src/hooks/use-account-restriction", () => ({
  useActiveSuspension: () => null,
  useAccountRestrictionSync: () => {},
}));

jest.mock("../src/hooks/use-receiver-transfers", () => ({
  useShipmentReceiverTransfers: jest.fn(() => ({ data: [] })),
  useReceiverTransferInvitations: jest.fn(() => ({ data: [] })),
  useCancelReceiverTransfer: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

const mockChatList = jest.fn(() => ({ data: [] as { shipmentId: string; unreadCount: number }[] }));
jest.mock("../src/hooks/use-chat", () => ({ useChatList: () => mockChatList() }));

const mockRouterDismissTo = jest.fn();

// El menú nativo no tiene representación en el árbol de React: cada acción se simula como una fila
// tocable (mismo criterio que `sender-actions-bar.test.tsx`).
jest.mock("@react-native-menu/menu", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    MenuView: ({ testID, actions, onPressAction, children }: any) => (
      <View testID={testID}>
        {children}
        {actions.map((action: any) => (
          <Pressable
            key={action.id}
            testID={`${testID}-action-${action.id}`}
            onPress={() => onPressAction?.({ nativeEvent: { event: action.id } })}
          >
            <Text>{action.title}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

jest.mock("expo-router", () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    dismissTo: (...args: unknown[]) => mockRouterDismissTo(...args),
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

const mockUseShipmentSettlement = jest.fn((..._args: unknown[]) => ({
  data: undefined as unknown,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
}));
jest.mock("../src/hooks/use-shipment-settlement", () => ({
  useShipmentSettlement: (...args: unknown[]) => mockUseShipmentSettlement(...args),
}));

const mockUseShipmentHold = jest.fn((..._args: unknown[]) => ({
  data: undefined as unknown,
  refetch: jest.fn(),
}));
jest.mock("../src/hooks/use-shipment-hold", () => ({
  useShipmentHold: (...args: unknown[]) => mockUseShipmentHold(...args),
}));

const mockCancellationQuote = jest.fn();
const mockCarrierQuote = jest.fn();
const mockCarrierWithdraw = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: (...args: unknown[]) => mockUseShipment(...args),
  useShipmentPhotos: () => ({ data: [], isLoading: false, isStale: false, refetch: jest.fn() }),
  useShipmentRoute: () => ({ data: undefined }),
  useShipmentEvents: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
  useAcceptShipment: () => mockAcceptMutation,
  useRejectShipment: () => mockRejectMutation,
  useCancelShipment: () => mockCancelMutation,
  useCancellationQuote: () => ({ mutateAsync: mockCancellationQuote }),
  useCarrierWithdrawalQuote: () => ({ mutateAsync: mockCarrierQuote }),
  useCarrierWithdraw: () => ({ mutateAsync: mockCarrierWithdraw, isPending: false }),
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

describe("ShipmentDetailScreen", () => {
  beforeEach(() => {
    mockCanGoBack.mockReturnValue(true);
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
  });
  afterEach(() => jest.clearAllMocks());

  it("muestra el skeleton con la forma de la pantalla mientras el fetch está pendiente", async () => {
    mockUseShipment.mockReturnValue({ isLoading: true, isError: false, data: undefined, error: null, refetch: jest.fn() });

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-skeleton")).toBeTruthy();
    expect(queryByTestId("shipment-detail-route-map")).toBeNull();
  });

  it("MOVO-168: mientras el envío carga, el header (volver y título) ya está a la vista", async () => {
    mockUseShipment.mockReturnValue({ isLoading: true, isError: false, data: undefined, error: null, refetch: jest.fn() });

    const { getByTestId, getByText, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByText("Detalle del envío")).toBeTruthy();
    expect(getByTestId("shipment-detail-back")).toBeTruthy();
    expect(getByTestId("shipment-detail-header-skeleton")).toBeTruthy();
    expect(queryByTestId("shipment-detail-status-badge")).toBeNull();
  });

  it("distingue un envío ajeno (403) de uno inexistente (404)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new ApiError(403, "AUTH_FORBIDDEN", "forbidden"),
      refetch: jest.fn(),
    });

    const { getByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Este envío no te pertenece.")).toBeTruthy();
  });

  it("muestra el mensaje de envío inexistente ante un 404", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new ApiError(404, "NOT_FOUND", "not found"),
      refetch: jest.fn(),
    });

    const { getByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Este envío no existe.")).toBeTruthy();
  });

  it("renderiza el mapa de ruta, el paquete, el precio y el receptor de un envío propio (mirando como emisor)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId, getByText, queryByTestId, queryByText } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-route-map")).toBeTruthy();
    expect(getByTestId("shipment-detail-package")).toBeTruthy();
    expect(getByText("Participantes")).toBeTruthy();
    expect(queryByTestId("shipment-detail-pickup-package")).toBeNull();
    expect(getByTestId("shipment-detail-receiver-subtitle")).toHaveTextContent(/^Receptor/);
    expect(getByText("Tomás Olmos")).toBeTruthy();
    expect(getByText("$4.500")).toBeTruthy();
    expect(queryByTestId("shipment-detail-carrier")).toBeNull();
    expect(queryByTestId("shipment-detail-receiver-actions")).toBeNull();
    // El fixture por defecto está en `published` (cancelable) y el usuario actual es
    // el emisor -- MOVO-29 muestra acá el botón de cancelar en el header.
    expect(getByTestId("shipment-detail-sender-actions")).toBeTruthy();
    // Feedback post-QA: sin CTA de "Volver a Inicio" al pie de la pantalla.
    expect(queryByText("Volver a Inicio")).toBeNull();
  });

  it("mirando como receptor no muestra el precio: no es un dato que le corresponda", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ agreedPriceArs: 5000, carrierId: "carrier-1" }),
      error: null,
      refetch: jest.fn(),
    });
    const { getByText, queryByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Retiro")).toBeTruthy();
    expect(queryByText("Precio pactado")).toBeNull();
    expect(queryByText("Costo aproximado")).toBeNull();
    expect(queryByText("$5.000")).toBeNull();
  });

  describe("MOVO-278: in_transit demorado", () => {
    it("muestra 'Demorado' en el badge y el banner explicativo", async () => {
      mockCurrentUser.mockReturnValue({ userId: "user-1" });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({
          carrierId: "carrier-1",
          status: ShipmentStatus.IN_TRANSIT,
          transitAnomalyFlaggedAt: "2026-10-04T10:00:00.000Z",
        }),
        error: null,
        refetch: jest.fn(),
      });
      const { getByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-status-badge")).toHaveTextContent("Demorado");
      expect(getByTestId("shipment-detail-delayed-banner")).toHaveTextContent(
        "La entrega está demorada. Si no se confirma pronto, vamos a abrir una disputa.",
      );
    });

    it("sin marca no muestra el banner y el badge dice 'En camino'", async () => {
      mockCurrentUser.mockReturnValue({ userId: "user-1" });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "carrier-1", status: ShipmentStatus.IN_TRANSIT }),
        error: null,
        refetch: jest.fn(),
      });
      const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-status-badge")).toHaveTextContent("En camino");
      expect(queryByTestId("shipment-detail-delayed-banner")).toBeNull();
    });
  });

  describe("encabezado: rol y código del envío", () => {
    function withShipment() {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ id: "8f2a1c3e-0000-4000-8000-000000012345" }),
        error: null,
        refetch: jest.fn(),
      });
    }

    it("mirando como emisor muestra ENVIÁS y el código #MOVO del resto de la app", async () => {
      mockCurrentUser.mockReturnValue({ userId: "user-1" });
      withShipment();
      const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

      expect(getByText("Enviás ·")).toBeTruthy();
      expect(getByTestId("shipment-detail-code").props.children).toBe("#MOVO-12345");
    });

    it("mirando como receptor muestra RECIBÍS", async () => {
      mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
      withShipment();
      const { getByText, queryByText } = await render(<ShipmentDetailScreen />);

      expect(getByText("Recibís ·")).toBeTruthy();
      expect(queryByText("Enviás ·")).toBeNull();
    });

    it("sin ser emisor ni receptor muestra solo el código, sin tag de rol", async () => {
      mockCurrentUser.mockReturnValue({ userId: "otra-persona" });
      withShipment();
      const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(queryByTestId("shipment-detail-role")).toBeNull();
      expect(getByTestId("shipment-detail-code")).toBeTruthy();
    });
  });

  // MOVO-176: la sheet chica de MOVO-154 se reemplazó por una pantalla completa.
  it("tocar la card del receptor navega a la pantalla de perfil público", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    await fireEvent.press(getByTestId("shipment-detail-receiver"));
    expect(mockRouterPush).toHaveBeenCalledWith("/profile/receiver-1");
  });

  it("mirando como receptor, muestra la card del emisor como contraparte (AC1/AC3 de MOVO-131)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.PUBLISHED }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId, getByText, queryByTestId, queryByText } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-sender-subtitle")).toHaveTextContent(/^Emisor/);
    expect(getByText("Pedro Emisor")).toBeTruthy();
    // Sin precio, retiro y paquete comparten la fila.
    expect(getByTestId("shipment-detail-pickup-package")).toBeTruthy();
    expect(getByTestId("shipment-detail-package")).toHaveTextContent(/kg · \d+ × \d+ × \d+/);
    expect(queryByTestId("shipment-detail-receiver")).toBeNull();
    expect(queryByText("Pendiente")).toBeNull();
    expect(queryByText("Aceptó")).toBeNull();
  });

  it("mirando como receptor en awaiting_receiver_confirmation, muestra la barra de acciones (AC4 de MOVO-131)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-receiver-actions")).toBeTruthy();
  });

  it("mirando como receptor con el plazo vencido, oculta la barra de acciones y muestra el banner (MOVO-130 AC5)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({
        status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        receiverConfirmationDeadline: new Date(Date.now() - 60_000).toISOString(),
      }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-receiver-actions")).toBeNull();
    expect(getByTestId("shipment-detail-expired-banner")).toBeTruthy();
  });

  it("mirando como receptor con el plazo todavía vigente, muestra la barra y no el banner (MOVO-130 AC5)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({
        status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        receiverConfirmationDeadline: new Date(Date.now() + 60 * 60_000).toISOString(),
      }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-receiver-actions")).toBeTruthy();
    expect(queryByTestId("shipment-detail-expired-banner")).toBeNull();
  });

  it("mirando como emisor con el plazo vencido, no muestra el banner del receptor (MOVO-130 AC5)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({
        status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
        receiverConfirmationDeadline: new Date(Date.now() - 60_000).toISOString(),
      }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-expired-banner")).toBeNull();
    expect(queryByTestId("shipment-detail-receiver-actions")).toBeNull();
  });

  it("mirando como emisor en awaiting_receiver_confirmation, NO muestra la barra de acciones", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-receiver-actions")).toBeNull();
  });

  it("mirando como receptor en estado publicado u otro posterior, NO muestra la barra de acciones", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.PUBLISHED }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-receiver-actions")).toBeNull();
  });

  it("mirando como emisor en estado cancelable, muestra el botón de cancelar (MOVO-29)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.ASSIGNMENT_PENDING }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-sender-actions")).toBeTruthy();
  });

  it("mirando como emisor en assigned, muestra el menú de cancelar y que el precio está reservado (MOVO-308)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.ASSIGNED, carrierId: "carrier-1", agreedPriceArs: 18500 }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId, getByText, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-sender-actions")).toBeTruthy();
    expect(getByText("Reservado en tu tarjeta")).toBeTruthy();
    expect(queryByTestId("shipment-detail-receiver-actions")).toBeNull();
  });

  it("mirando como receptor, nunca muestra la barra de cancelar del emisor (MOVO-29)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.PUBLISHED }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-sender-actions")).toBeNull();
  });

  it("muestra la card de transportista solo cuando el envío ya tiene uno asignado", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ carrierId: "carrier-1", status: ShipmentStatus.ASSIGNED }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-carrier")).toBeTruthy();
  });

  it("oculta la card de transportista en completed, igual que en delivered (MOVO-208)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ carrierId: "carrier-1", status: ShipmentStatus.COMPLETED }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-carrier")).toBeNull();
  });

  it("muestra la sección de calificaciones en completed, igual que en delivered (MOVO-208)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ carrierId: "carrier-1", status: ShipmentStatus.COMPLETED }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-ratings")).toBeTruthy();
  });

  it("muestra 'Precio pactado' y el monto pactado cuando agreedPriceArs está presente (MOVO-244)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({
        suggestedPriceArs: 4500,
        agreedPriceArs: 6000,
        status: ShipmentStatus.ASSIGNMENT_PENDING,
        carrierId: "carrier-1",
      }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Precio pactado")).toBeTruthy();
    expect(getByText("$6.000")).toBeTruthy();
    expect(queryByText("Costo aproximado")).toBeNull();
  });

  it("muestra 'Precio pactado' cuando carrierId está presente aunque agreedPriceArs sea null (MOVO-244)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({
        suggestedPriceArs: 4500,
        agreedPriceArs: null,
        status: ShipmentStatus.ASSIGNED,
        carrierId: "carrier-1",
      }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Precio pactado")).toBeTruthy();
    expect(getByText("$4.500")).toBeTruthy();
    expect(queryByText("Costo aproximado")).toBeNull();
  });

  it("muestra 'Costo aproximado' y el precio sugerido cuando no hay oferta aceptada (sin carrier y agreedPriceArs null)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({
        suggestedPriceArs: 4500,
        agreedPriceArs: null,
        status: ShipmentStatus.PUBLISHED,
        carrierId: null,
      }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText, queryByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Costo aproximado")).toBeTruthy();
    expect(getByText("$4.500")).toBeTruthy();
    expect(queryByText("Precio pactado")).toBeNull();
  });

  describe("badge de alta demanda (MOVO-254)", () => {
    function renderWith(overrides: Partial<ShipmentSummary>) {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment(overrides),
        error: null,
        refetch: jest.fn(),
      });
      return render(<ShipmentDetailScreen />);
    }

    it("al tocarlo, la explicación aparece debajo de la fila de cards y no dentro de la de precio", async () => {
      const { getByTestId, queryByTestId } = await renderWith({ highDemand: true });

      expect(queryByTestId("shipment-detail-high-demand-explainer")).toBeNull();
      await act(async () => {
        fireEvent.press(getByTestId("shipment-detail-high-demand-toggle"));
      });
      expect(getByTestId("shipment-detail-high-demand-explainer")).toBeTruthy();
      // La ayuda está dentro del contenedor externo, fuera de la card de precio.
      expect(getByTestId("shipment-detail-high-demand-help")).toBeTruthy();

      await act(async () => {
        fireEvent.press(getByTestId("shipment-detail-high-demand-toggle"));
      });
      expect(queryByTestId("shipment-detail-high-demand-explainer")).toBeNull();
    });

    it("lo muestra al emisor junto al precio sugerido si highDemand es true", async () => {
      const { getByTestId, getByText } = await renderWith({ highDemand: true });

      expect(getByTestId("shipment-detail-high-demand")).toBeTruthy();
      expect(getByText("Costo aproximado")).toBeTruthy();
    });

    it("la pill es corta y la ayuda se despliega a todo el ancho, fuera de la card de precio", async () => {
      const { getByTestId, getByText, queryByTestId } = await renderWith({ highDemand: true });

      expect(getByText("Alta demanda")).toBeTruthy();
      expect(queryByTestId("shipment-detail-high-demand-help")).toBeNull();

      await fireEvent.press(getByTestId("shipment-detail-high-demand-toggle"));
      expect(getByTestId("shipment-detail-high-demand-help")).toBeTruthy();

      await fireEvent.press(getByTestId("shipment-detail-high-demand-toggle"));
      expect(queryByTestId("shipment-detail-high-demand-help")).toBeNull();
    });

    it.each([
      ["false", false],
      ["null (sin cotización o envío anterior)", null],
    ])("no lo muestra si highDemand es %s", async (_label, highDemand) => {
      const { queryByTestId } = await renderWith({ highDemand });

      expect(queryByTestId("shipment-detail-high-demand")).toBeNull();
    });

    it("no lo muestra si el envío ya tiene precio acordado", async () => {
      const { queryByTestId } = await renderWith({
        highDemand: true,
        agreedPriceArs: 6000,
        carrierId: "carrier-1",
        status: ShipmentStatus.ASSIGNMENT_PENDING,
      });

      expect(queryByTestId("shipment-detail-high-demand")).toBeNull();
    });

    it("no lo muestra con transportista asignado aunque agreedPriceArs sea null", async () => {
      const { queryByTestId, getByText } = await renderWith({
        highDemand: true,
        agreedPriceArs: null,
        carrierId: "carrier-1",
        status: ShipmentStatus.ASSIGNED,
      });

      expect(getByText("Precio pactado")).toBeTruthy();
      expect(queryByTestId("shipment-detail-high-demand")).toBeNull();
    });

    it("no lo muestra al receptor", async () => {
      mockCurrentUser.mockReturnValue({ userId: "receiver-1" });

      const { queryByTestId } = await renderWith({ highDemand: true });

      expect(queryByTestId("shipment-detail-high-demand")).toBeNull();
    });
  });

  it("cambia a la tab de línea de tiempo al tocarla, mostrando el historial (MOVO-128)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-timeline")).toBeNull();

    await fireEvent.press(getByTestId("shipment-detail-tab-timeline"));

    expect(getByTestId("shipment-detail-timeline")).toBeTruthy();
    expect(queryByTestId("shipment-detail-route-map")).toBeNull();
  });

  it("muestra el banner de ofertas (siempre vacío, MOVO-17 sin arrancar) solo mientras el envío sigue abierto", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.PUBLISHED, carrierId: null }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-offers")).toBeTruthy();
    expect(getByText("Aún no tenés ofertas")).toBeTruthy();
  });

  it("la bandeja de ofertas va arriba del mapa: es la acción principal del emisor con el envío publicado", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.PUBLISHED, carrierId: null }),
      error: null,
      refetch: jest.fn(),
    });

    const { container } = await render(<ShipmentDetailScreen />);
    // Orden de render (recorrido en profundidad) de los testIDs de la pantalla.
    const ids = container
      .queryAll((node) => typeof node.props.testID === "string")
      .map((node) => node.props.testID as string);

    expect(ids).toContain("shipment-detail-offers");
    expect(ids.indexOf("shipment-detail-offers")).toBeLessThan(ids.indexOf("shipment-detail-route-map"));
  });

  it("no muestra el banner de ofertas si el envío ya tiene transportista asignado", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.ASSIGNED, carrierId: "carrier-1" }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-offers")).toBeNull();
  });

  it("no muestra el banner de ofertas mientras el receptor todavía no confirmó", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, carrierId: null }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-offers")).toBeNull();
  });

  it("muestra el badge de 'pendiente de confirmación' del receptor cuando el envío todavía no fue confirmado", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Pendiente")).toBeTruthy();
  });

  it("muestra el badge de 'rechazó el envío' del receptor cuando el receptor lo rechazó", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.REJECTED_BY_RECEIVER }),
      error: null,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<ShipmentDetailScreen />);

    expect(getByText("Rechazó")).toBeTruthy();
  });

  it("hace pop de la pila con router.back() al tocar volver, en vez de empujar Inicio encima", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });
    mockCanGoBack.mockReturnValue(true);

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    await fireEvent.press(getByTestId("shipment-detail-back"));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("cae a router.replace(home) al volver solo si no hay historial (entrada directa)", async () => {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(),
      error: null,
      refetch: jest.fn(),
    });
    mockCanGoBack.mockReturnValue(false);

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    await fireEvent.press(getByTestId("shipment-detail-back"));

    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/(tabs)/home");
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  describe("CTA contextual por rol y estado (MOVO-194 AC2)", () => {
    const SENDER = "user-1";
    const CARRIER = "user-2";
    const RECEIVER = "receiver-1";

    it.each([
      [SENDER, ShipmentStatus.ASSIGNED, "Generar retiro", "/(app)/shipments/shipment-1/handshake"],
      [CARRIER, ShipmentStatus.ASSIGNED, "Retirar paquete", "/(app)/shipments/shipment-1/pickup"],
      [CARRIER, ShipmentStatus.IN_TRANSIT, "Entregar paquete", "/(app)/shipments/shipment-1/delivery"],
      [RECEIVER, ShipmentStatus.IN_TRANSIT, "Confirmar recepción", "/(app)/shipments/shipment-1/handshake-scan"],
    ])("usuario %s en %s ve '%s' y navega a %s", async (userId, status, label, path) => {
      mockCurrentUser.mockReturnValue({ userId });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: CARRIER, status }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

      expect(getByText(label)).toBeTruthy();
      await fireEvent.press(getByTestId("shipment-detail-cta"));
      expect(mockRouterPush).toHaveBeenCalledWith(path);
    });

    it.each([SENDER, CARRIER])(
      "en assigned_unfunded el usuario %s no tiene CTA ni texto al pie: la card de la reserva lo explica (MOVO-211)",
      async (userId) => {
        mockCurrentUser.mockReturnValue({ userId });
        mockUseShipment.mockReturnValue({
          isLoading: false,
          isError: false,
          // Retiro lejano: la ventana para confirmar el pago todavía no se abrió (MOVO-269).
          data: shipment({
            carrierId: CARRIER,
            status: ShipmentStatus.ASSIGNED_UNFUNDED,
            pickupDate: "2099-01-01",
            funding:
              userId === SENDER
                ? {
                    viewer: "sender",
                    phase: "awaiting_window",
                    windowOpensAt: "2098-12-29T12:00:00.000Z",
                    payUntil: "2098-12-31T12:00:00.000Z",
                    amountArs: 18400,
                  }
                : { viewer: "carrier", phase: "sender_payment_pending", payUntil: "2098-12-31T12:00:00.000Z" },
          }),
          error: null,
          refetch: jest.fn(),
        });

        const { queryByTestId, queryByText } = await render(<ShipmentDetailScreen />);

        expect(queryByTestId("shipment-detail-cta")).toBeNull();
        expect(queryByTestId("shipment-detail-cta-info")).toBeNull();
        expect(queryByText("Los fondos se reservan antes del retiro.")).toBeNull();
      },
    );

    it("con la card de la reserva a la vista, el pago se pide ahí y no también al pie (MOVO-211)", async () => {
      mockCurrentUser.mockReturnValue({ userId: SENDER });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({
          carrierId: CARRIER,
          status: ShipmentStatus.ASSIGNMENT_PENDING,
          funding: {
            viewer: "sender",
            phase: "payment_due",
            route: "near",
            amountArs: 18400,
            payUntil: "2026-10-08T13:00:00.000Z",
            lastAttempt: "none",
            failureReason: null,
            card: null,
            holdLost: false,
          },
        }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-funds-cta")).toBeTruthy();
      expect(queryByTestId("shipment-detail-cta")).toBeNull();
    });

    it("en assigned_unfunded con la ventana abierta el emisor ve 'Confirmar el pago' (MOVO-269)", async () => {
      mockCurrentUser.mockReturnValue({ userId: SENDER });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: CARRIER, status: ShipmentStatus.ASSIGNED_UNFUNDED, pickupDate: "2000-01-01" }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

      expect(getByText("Confirmar el pago")).toBeTruthy();
      await fireEvent.press(getByTestId("shipment-detail-cta"));
      expect(mockRouterPush).toHaveBeenCalledWith("/(app)/shipments/shipment-1/pay");
    });

    it("en assignment_pending el emisor puede retomar el pago desde el detalle (MOVO-269 AC7)", async () => {
      mockCurrentUser.mockReturnValue({ userId: SENDER });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: CARRIER, status: ShipmentStatus.ASSIGNMENT_PENDING }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

      expect(getByText("Pagar y reservar fondos")).toBeTruthy();
      await fireEvent.press(getByTestId("shipment-detail-cta"));
      expect(mockRouterPush).toHaveBeenCalledWith("/(app)/shipments/shipment-1/pay?resumed=1");
    });

    it.each([
      [SENDER, ShipmentStatus.PUBLISHED],
      [SENDER, ShipmentStatus.IN_TRANSIT],
      [RECEIVER, ShipmentStatus.ASSIGNED],
      [CARRIER, ShipmentStatus.DELIVERED],
      [SENDER, ShipmentStatus.CANCELLED],
      [RECEIVER, ShipmentStatus.COMPLETED],
    ])("usuario %s en %s no ve CTA", async (userId, status) => {
      mockCurrentUser.mockReturnValue({ userId });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: CARRIER, status }),
        error: null,
        refetch: jest.fn(),
      });

      const { queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(queryByTestId("shipment-detail-cta")).toBeNull();
      expect(queryByTestId("shipment-detail-cta-info")).toBeNull();
    });
  });

  describe("vista del transportista y del receptor (MOVO-194)", () => {
    it.each([
      // MOVO-225: neto (5000) menos el estimado de MP sobre el bruto (5750 * 4,99%).
      ["user-2", "Recibís aprox.", "$4.713,07"],
      ["user-1", "Precio pactado", "$5.750"],
    ])("sobre el mismo agreedPriceArs, el usuario %s ve '%s' %s", async (userId, label, amount) => {
      mockCurrentUser.mockReturnValue({ userId });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "user-2", agreedPriceArs: 5750, status: ShipmentStatus.ASSIGNED }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByText, getByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByText(label)).toBeTruthy();
      expect(getByTestId("shipment-detail-price")).toHaveTextContent(amount);
    });

    it("el receptor ve el retiro y la entrega en el mapa, igual que el resto de las partes", async () => {
      mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "user-2", status: ShipmentStatus.IN_TRANSIT }),
        error: null,
        refetch: jest.fn(),
      });

      await render(<ShipmentDetailScreen />);

      const props = mockRouteMapCard.mock.calls.at(-1)[0];
      expect(props.pickup).toEqual({ address: "Av. Colón 1234, Córdoba", lat: -31.4, lng: -64.18 });
      expect(props.pickupLabel).toBeUndefined();
      expect(props.delivery).toEqual({ address: "Bv. San Juan 500, Córdoba", lat: -31.41, lng: -64.19 });
    });

    it("el emisor sigue viendo el retiro completo en el mapa", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment(),
        error: null,
        refetch: jest.fn(),
      });

      await render(<ShipmentDetailScreen />);

      const props = mockRouteMapCard.mock.calls.at(-1)[0];
      expect(props.pickup).toEqual({ address: "Av. Colón 1234, Córdoba", lat: -31.4, lng: -64.18 });
      expect(props.pickupLabel).toBeUndefined();
    });

    it("el transportista ve las cards de emisor y receptor, y no la suya", async () => {
      mockCurrentUser.mockReturnValue({ userId: "user-2" });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: "user-2", status: ShipmentStatus.ASSIGNED }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, queryByTestId, getByText } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-sender")).toBeTruthy();
      expect(getByTestId("shipment-detail-receiver")).toBeTruthy();
      expect(queryByTestId("shipment-detail-carrier")).toBeNull();
      expect(getByText(/Transportás/)).toBeTruthy();
    });

    describe("MOVO-314: bajarse del envío", () => {
      const asCarrier = (status: ShipmentStatus, carrierId = "user-2") => {
        mockCurrentUser.mockReturnValue({ userId: "user-2" });
        mockUseShipment.mockReturnValue({
          isLoading: false,
          isError: false,
          data: shipment({ carrierId, status }),
          error: null,
          refetch: jest.fn(),
        });
      };

      it.each([ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED, ShipmentStatus.ASSIGNED])(
        "AC1: el transportista ve 'No puedo hacer este envío' en %s",
        async (status) => {
          asCarrier(status);
          const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

          expect(getByTestId("shipment-detail-carrier-actions")).toBeTruthy();
          expect(getByText("No puedo hacer este envío")).toBeTruthy();
        },
      );

      it("no aparece una vez retirado el paquete", async () => {
        asCarrier(ShipmentStatus.IN_TRANSIT);
        const { queryByTestId } = await render(<ShipmentDetailScreen />);

        expect(queryByTestId("shipment-detail-carrier-actions")).toBeNull();
      });

      it("no aparece para quien no es el transportista", async () => {
        asCarrier(ShipmentStatus.ASSIGNED, "otro-transportista");
        const { queryByTestId } = await render(<ShipmentDetailScreen />);

        expect(queryByTestId("shipment-detail-carrier-actions")).toBeNull();
      });

      it("AC3: tras confirmar sale del detalle al Inicio con el aviso", async () => {
        asCarrier(ShipmentStatus.ASSIGNED);
        mockCarrierQuote.mockResolvedValue({ penaltyArs: 0, reason: "before_free_deadline", freeUntil: null });
        mockCarrierWithdraw.mockResolvedValue({});
        const { getByTestId, findByTestId } = await render(<ShipmentDetailScreen />);

        await fireEvent.press(getByTestId("shipment-detail-carrier-actions-menu-action-withdraw-shipment"));
        await fireEvent.press(await findByTestId("shipment-detail-carrier-actions-sheet-confirm"));

        await waitFor(() =>
          expect(mockRouterDismissTo).toHaveBeenCalledWith({
            pathname: "/(app)/(tabs)/home",
            params: { withdrawnNotice: "Cancelaste el envío. Ya no está en tu viaje.", withdrawnAt: expect.any(String) },
          }),
        );
      });
    });
  });

  describe("detalle del pago (MOVO-214)", () => {
    const CREDITED_CARRIER = {
      shipmentId: "shipment-1",
      role: "carrier",
      status: "credited",
      paidAmountArs: 13800,
      paidAt: "2026-10-14T19:42:00.000Z",
      mpFeeArs: 688.62,
      commissionArs: 1800,
      netAmountArs: 11311.38,
    };

    afterEach(() => settlementReturns(undefined));

    function settlementReturns(data: unknown) {
      mockUseShipmentSettlement.mockReturnValue({ data, isLoading: false, isError: false, refetch: jest.fn() });
    }

    function mockFulfilled(userId: string, status = ShipmentStatus.COMPLETED) {
      mockCurrentUser.mockReturnValue({ userId });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({
          carrierId: "user-2",
          agreedPriceArs: 13800,
          status,
          deliveredAt: "2026-10-14T19:40:00.000Z",
        }),
        error: null,
        refetch: jest.fn(),
      });
    }

    it("AC1: el transportista ve bruto, comisión, fee de MP y neto acreditado, sin el precio estimado", async () => {
      mockFulfilled("user-2");
      settlementReturns(CREDITED_CARRIER);

      const { getByTestId, getByText, queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-payment-pill")).toHaveTextContent("Acreditado");
      expect(getByText("$13.800")).toBeTruthy();
      expect(getByText("− $1.800")).toBeTruthy();
      expect(getByText("− $688,62")).toBeTruthy();
      expect(getByTestId("shipment-detail-payment-net")).toHaveTextContent("$11.311,38");
      expect(getByTestId("shipment-detail-payment-date")).toHaveTextContent(/Acreditado el .+ en tu cuenta de Mercado Pago/);
      expect(queryByTestId("shipment-detail-price")).toBeNull();
    });

    it("AC2: el emisor ve el total pagado y la fecha, sin el neto ni la comisión", async () => {
      mockFulfilled("user-1");
      settlementReturns({ shipmentId: "shipment-1", role: "sender", status: "credited", paidAmountArs: 13800, paidAt: "2026-10-14T19:42:00.000Z" });

      const { getByTestId, queryByText } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-payment-pill")).toHaveTextContent("Cobrado");
      expect(getByTestId("shipment-detail-payment-total")).toHaveTextContent("$13.800");
      expect(getByTestId("shipment-detail-payment-date")).toHaveTextContent(/Mercado Pago lo cobró el/);
      expect(queryByText(/Comisión/)).toBeNull();
      expect(queryByText("Te acreditamos")).toBeNull();
    });

    it("AC3: el receptor no ve nada del pago y no se consulta", async () => {
      mockFulfilled("receiver-1");

      const { queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(queryByTestId("shipment-detail-payment")).toBeNull();
      expect(mockUseShipmentSettlement).toHaveBeenLastCalledWith("shipment-1", expect.objectContaining({ enabled: false }));
    });

    it("antes de la entrega no hay sección de pago", async () => {
      mockFulfilled("user-2", ShipmentStatus.IN_TRANSIT);

      const { queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(queryByTestId("shipment-detail-payment")).toBeNull();
      expect(mockUseShipmentSettlement).toHaveBeenLastCalledWith("shipment-1", expect.objectContaining({ enabled: false }));
    });

    it("AC4: sin liquidación todavía, el transportista ve 'cobrando' y ningún monto acreditado", async () => {
      mockFulfilled("user-2", ShipmentStatus.DELIVERED);
      settlementReturns(null);

      const { getByTestId, getByText, queryByText } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-payment-pill")).toHaveTextContent("Cobrando");
      expect(getByText("Estamos cobrando el envío")).toBeTruthy();
      expect(getByTestId("shipment-detail-payment-net")).toHaveTextContent("Se confirma al cobrar");
      expect(queryByText("$11.311,38")).toBeNull();
    });

    it("AC4: un neto informado pero sin acreditar no se muestra", async () => {
      mockFulfilled("user-2", ShipmentStatus.DELIVERED);
      settlementReturns({ ...CREDITED_CARRIER, status: "processing", paidAt: null });

      const { getByTestId, queryByText } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-payment-pill")).toHaveTextContent("Cobrando");
      expect(queryByText("$11.311,38")).toBeNull();
    });

    it("AC4: con la liquidación escalada, el transportista ve el cobro demorado", async () => {
      mockFulfilled("user-2", ShipmentStatus.DELIVERED);
      settlementReturns({ shipmentId: "shipment-1", role: "carrier", status: "escalated", paidAmountArs: 13800, paidAt: null, mpFeeArs: null, commissionArs: 1800, netAmountArs: null });

      const { getByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-payment-pill")).toHaveTextContent("Demorado");
      expect(getByTestId("shipment-detail-payment-escalated")).toHaveTextContent(/a la brevedad/);
      expect(getByTestId("shipment-detail-payment-net")).toHaveTextContent("En revisión");
    });

    it("la liquidación escalada el emisor la ve como pago en proceso", async () => {
      mockFulfilled("user-1", ShipmentStatus.DELIVERED);
      settlementReturns({ shipmentId: "shipment-1", role: "sender", status: "escalated", paidAmountArs: 13800, paidAt: null });

      const { getByTestId, queryByText } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-payment-pill")).toHaveTextContent("Procesando");
      expect(getByTestId("shipment-detail-payment-total")).toHaveTextContent("$13.800");
      expect(queryByText(/demorado/i)).toBeNull();
    });

    it("si la consulta falla, ofrece reintentar en vez de inventar un estado", async () => {
      mockFulfilled("user-2");
      const refetchSettlement = jest.fn();
      mockUseShipmentSettlement.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: refetchSettlement });

      const { getByTestId } = await render(<ShipmentDetailScreen />);
      fireEvent.press(getByTestId("shipment-detail-payment-retry"));

      expect(refetchSettlement).toHaveBeenCalled();
    });
  });

  describe("pull-to-refresh", () => {
    it("renderiza refresh control para pull-to-refresh en la vista de detalle", async () => {
      mockCurrentUser.mockReturnValue({ userId: "user-1" });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ senderId: "user-1", status: ShipmentStatus.PUBLISHED }),
        error: null,
        refetch: jest.fn(),
      });

      const { toJSON } = await render(<ShipmentDetailScreen />);
      const findNode = (node: any, type: string): any => {
        if (!node) return null;
        if (node.type === type) return node;
        if (node.children) {
          for (const c of node.children) {
            const found = findNode(c, type);
            if (found) return found;
          }
        }
        return null;
      };
      const scrollViewNode = findNode(toJSON(), "RCTScrollView");
      expect(scrollViewNode?.props?.refreshControl).toBeTruthy();
    });
  });

  describe("MOVO-253 AC6: envío rechazado, vista emisor", () => {
    const futureDeadline = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    it("muestra motivo, plazo y el CTA de elegir otro receptor", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
        data: shipment({
          status: ShipmentStatus.REJECTED_BY_RECEIVER,
          rejectionReason: "No estoy en la ciudad",
          receiverRedesignationDeadline: futureDeadline(),
        }),
      });

      const { getByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-rejected-banner-reason")).toHaveTextContent("“No estoy en la ciudad”");
      expect(getByTestId("shipment-detail-rejected-banner-deadline")).toHaveTextContent(/^Tenés hasta/);
      await fireEvent.press(getByTestId("shipment-detail-rejected-banner-cta"));
      expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/change-receiver");
    });

    it("con el plazo vencido, avisa y no ofrece el CTA", async () => {
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
        data: shipment({
          status: ShipmentStatus.REJECTED_BY_RECEIVER,
          receiverRedesignationDeadline: new Date(Date.now() - 1000).toISOString(),
        }),
      });

      const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-rejected-banner-expired")).toBeTruthy();
      expect(queryByTestId("shipment-detail-rejected-banner-cta")).toBeNull();
    });

    it("el receptor no ve el banner", async () => {
      mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
        data: shipment({
          status: ShipmentStatus.REJECTED_BY_RECEIVER,
          receiverRedesignationDeadline: futureDeadline(),
        }),
      });

      const { queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(queryByTestId("shipment-detail-rejected-banner")).toBeNull();
    });
  });
  describe("estado de la reserva de fondos (MOVO-211)", () => {
    const SENDER = "user-1";
    const CARRIER = "user-2";
    const RECEIVER = "receiver-1";
    const PAY_UNTIL = "2026-10-08T13:00:00.000Z";

    it("el emisor ve la card de la reserva arriba del detalle", async () => {
      mockCurrentUser.mockReturnValue({ userId: SENDER });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({
          carrierId: CARRIER,
          status: ShipmentStatus.ASSIGNED,
          agreedPriceArs: 18400,
          funding: { viewer: "sender", phase: "held", amountArs: 18400, card: null },
        }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-funds-held")).toBeTruthy();
    });

    it("el transportista ve solo si el pago está pendiente, sin montos", async () => {
      mockCurrentUser.mockReturnValue({ userId: CARRIER });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({
          carrierId: CARRIER,
          status: ShipmentStatus.ASSIGNMENT_PENDING,
          agreedPriceArs: 18400,
          funding: { viewer: "carrier", phase: "sender_payment_pending", payUntil: PAY_UNTIL },
        }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, queryByText } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-funds-carrier-pending")).toBeTruthy();
      expect(queryByText(/18\.400/)).toBeNull();
    });

    it("el receptor no ve ninguna card de la reserva", async () => {
      mockCurrentUser.mockReturnValue({ userId: RECEIVER });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({ carrierId: CARRIER, status: ShipmentStatus.ASSIGNED, funding: null }),
        error: null,
        refetch: jest.fn(),
      });

      const { queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(queryByTestId(/^shipment-detail-funds/)).toBeNull();
    });

    it("vuelta a publicar: la card explica el motivo y la bandeja de abajo es el único acceso a las ofertas", async () => {
      mockCurrentUser.mockReturnValue({ userId: SENDER });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({
          carrierId: null,
          status: ShipmentStatus.PUBLISHED,
          funding: { viewer: "sender", phase: "lapsed", reason: "payment_timeout", at: PAY_UNTIL },
        }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, queryByTestId, container } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-funds-lapsed")).toBeTruthy();
      expect(queryByTestId("shipment-detail-funds-offers")).toBeNull();
      const ids = container
        .queryAll((node) => typeof node.props.testID === "string")
        .map((node) => node.props.testID as string);
      expect(ids.indexOf("shipment-detail-funds-lapsed")).toBeLessThan(ids.indexOf("shipment-detail-offers"));
    });

    it("el ex-transportista ve por qué se liberó, sin precio ni datos de las partes", async () => {
      const formerCarrier = "former-carrier";
      mockCurrentUser.mockReturnValue({ userId: formerCarrier });
      mockUseShipment.mockReturnValue({
        isLoading: false,
        isError: false,
        data: shipment({
          carrierId: null,
          status: ShipmentStatus.PUBLISHED,
          funding: {
            viewer: "former_carrier",
            phase: "lapsed",
            reason: "window_expired",
            at: "2026-10-08T13:00:00.000Z",
          },
        }),
        error: null,
        refetch: jest.fn(),
      });

      const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-funds-carrier-lapsed")).toBeTruthy();
      expect(queryByTestId("shipment-detail-price")).toBeNull();
      expect(queryByTestId("shipment-detail-receiver")).toBeNull();
      expect(queryByTestId("shipment-detail-cta")).toBeNull();
    });
  });

});

describe("ShipmentDetailScreen — transferencia de receptor (MOVO-275)", () => {
  const transferBase = {
    id: "tr-1",
    shipmentId: "shipment-1",
    requestedBy: "lucia",
    requesterName: "Lucía Gómez",
    newReceiverId: "receiver-1",
    newReceiverName: "Martín López",
    reason: "Esa semana estoy de viaje",
    responseReason: null,
    cancelReason: null,
    newReceiverDeadline: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    createdAt: "2026-08-16T12:00:00.000Z",
    resolvedBy: null,
  };

  function mockDetail(data: ShipmentSummary) {
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, error: null, refetch: jest.fn(), data });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Un `mockReturnValueOnce` sin consumir de un test anterior del archivo se colaría
    // en el primer render de estos: `mockClear` no vacía esa cola.
    mockUseShipment.mockReset();
    mockCurrentUser.mockReset();
  });

  it("el receptor ve la acción 'Que lo reciba otra persona' y navega a elegir a la persona", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockDetail(
      shipment({
        status: ShipmentStatus.IN_TRANSIT,
        carrierId: "carrier-1",
        receiverTransfer: { viewerIsFormerReceiver: false, pending: null, completed: null },
      }),
    );

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    await fireEvent.press(getByTestId("shipment-detail-receiver-transfer-action"));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/receiver-transfer");
  });

  it("con una solicitud pendiente propia, muestra el plazo y la opción de cancelarla", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockDetail(
      shipment({
        status: ShipmentStatus.PUBLISHED,
        receiverTransfer: {
          viewerIsFormerReceiver: false,
          pending: {
            ...transferBase,
            requestedBy: "receiver-1",
            newReceiverId: "martin",
            status: "pending_new_receiver",
            resolvedAt: null,
          },
          completed: null,
        },
      }),
    );

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-receiver-transfer-pending")).toBeTruthy();
    expect(getByTestId("shipment-detail-receiver-transfer-pending-title")).toHaveTextContent("Esperando que Martín acepte");
    expect(getByTestId("shipment-detail-receiver-transfer-pending-deadline")).toHaveTextContent(/^Vence /);
    expect(getByTestId("shipment-detail-receiver-transfer-pending-cancel")).toBeTruthy();
    expect(queryByTestId("shipment-detail-receiver-transfer-action")).toBeNull();
  });

  it("cancelar la solicitud pide confirmación en una sheet y recién ahí cancela", async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    (useCancelReceiverTransfer as jest.Mock).mockReturnValue({ mutateAsync, isPending: false });
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockDetail(
      shipment({
        status: ShipmentStatus.PUBLISHED,
        receiverTransfer: {
          viewerIsFormerReceiver: false,
          pending: {
            ...transferBase,
            requestedBy: "receiver-1",
            newReceiverId: "martin",
            status: "pending_new_receiver",
            resolvedAt: null,
          },
          completed: null,
        },
      }),
    );

    const { getByTestId, queryByTestId, getByText } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-receiver-transfer-pending-cancel-sheet-confirm")).toBeNull();
    await fireEvent.press(getByTestId("shipment-detail-receiver-transfer-pending-cancel"));
    expect(getByText("¿Cancelar la solicitud?")).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("shipment-detail-receiver-transfer-pending-cancel-sheet-confirm"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ transferId: transferBase.id }));
  });

  it("el receptor nuevo ve que ya no se puede volver a transferir", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockDetail(
      shipment({
        status: ShipmentStatus.IN_TRANSIT,
        carrierId: "carrier-1",
        receiverTransfer: {
          viewerIsFormerReceiver: false,
          pending: null,
          completed: { ...transferBase, status: "completed", resolvedAt: "2026-08-16T12:20:00.000Z" },
        },
      }),
    );

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-receiver-transfer-used")).toBeTruthy();
    expect(queryByTestId("shipment-detail-receiver-transfer-action")).toBeNull();
  });

  it("el receptor original ve el detalle en solo lectura con el banner, sin precio", async () => {
    mockCurrentUser.mockReturnValue({ userId: "lucia" });
    mockDetail(
      shipment({
        status: ShipmentStatus.IN_TRANSIT,
        carrierId: "carrier-1",
        agreedPriceArs: 8400,
        receiverTransfer: {
          viewerIsFormerReceiver: true,
          pending: null,
          completed: { ...transferBase, status: "completed", resolvedAt: "2026-08-16T12:20:00.000Z" },
        },
      }),
    );

    const { getByTestId, queryByTestId, queryByText } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-transferred-banner")).toBeTruthy();
    expect(getByTestId("shipment-detail-transferred-banner-reason")).toHaveTextContent("“Esa semana estoy de viaje”");
    expect(getByTestId("shipment-detail-role")).toHaveTextContent(/Transferiste/);
    expect(queryByTestId("shipment-detail-price")).toBeNull();
    expect(queryByTestId("shipment-detail-receiver-transfer")).toBeNull();
    expect(queryByTestId("shipment-detail-cta")).toBeNull();
    const mapProps = mockRouteMapCard.mock.calls.at(-1)?.[0] as { pickup: unknown };
    expect(mapProps.pickup).not.toBeNull();
    // Participantes: emisor, transportista y el receptor nuevo con desde cuándo recibe.
    expect(getByTestId("shipment-detail-sender")).toBeTruthy();
    expect(getByTestId("shipment-detail-carrier")).toBeTruthy();
    expect(getByTestId("shipment-detail-receiver-subtitle")).toHaveTextContent(
      /^Receptor desde el \d{1,2} ago · antes, vos$/,
    );
    expect(queryByText("Aceptó")).toBeNull();
  });

  it("el emisor no tiene acción sobre la recepción", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockDetail(
      shipment({
        status: ShipmentStatus.IN_TRANSIT,
        carrierId: "carrier-1",
        receiverTransfer: { viewerIsFormerReceiver: false, pending: null, completed: null },
      }),
    );

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-receiver-transfer")).toBeNull();
  });
});


describe("ShipmentDetailScreen — seguimiento en vivo (MOVO-271 AC3/AC5)", () => {
  beforeEach(() => {
    mockCanGoBack.mockReturnValue(true);
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
  });
  afterEach(() => jest.clearAllMocks());

  function mockShipment(overrides: Partial<ShipmentSummary>) {
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment(overrides),
      error: null,
      refetch: jest.fn(),
    });
  }

  it.each([ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED, ShipmentStatus.ASSIGNED])(
    "antes del retiro (%s) muestra el placeholder y no navega",
    async (status) => {
      mockShipment({ carrierId: "carrier-1", status });

      const { getByTestId, queryByTestId, getByText } = await render(<ShipmentDetailScreen />);

      expect(getByTestId("shipment-detail-live-tracking-pending")).toBeTruthy();
      expect(queryByTestId("shipment-detail-live-tracking")).toBeNull();
      expect(getByText("Se activa al iniciar el recorrido")).toBeTruthy();
    },
  );

  it("en tránsito habilita la card y navega al mapa", async () => {
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.IN_TRANSIT });

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-live-tracking-pending")).toBeNull();
    await fireEvent.press(getByTestId("shipment-detail-live-tracking"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/shipments/shipment-1/tracking");
  });

  it("el receptor también la ve", async () => {
    mockCurrentUser.mockReturnValue({ userId: "receiver-1" });
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.IN_TRANSIT });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-live-tracking")).toBeTruthy();
  });

  it("no la muestra al transportista, sin transportista ni con el envío entregado", async () => {
    mockCurrentUser.mockReturnValue({ userId: "carrier-1" });
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.IN_TRANSIT });
    const asCarrier = await render(<ShipmentDetailScreen />);
    expect(asCarrier.queryByTestId("shipment-detail-live-tracking")).toBeNull();
    await asCarrier.unmount();

    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockShipment({ carrierId: null, status: ShipmentStatus.PUBLISHED });
    const withoutCarrier = await render(<ShipmentDetailScreen />);
    expect(withoutCarrier.queryByTestId("shipment-detail-live-tracking-pending")).toBeNull();
    await withoutCarrier.unmount();

    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.DELIVERED });
    const delivered = await render(<ShipmentDetailScreen />);
    expect(delivered.queryByTestId("shipment-detail-live-tracking")).toBeNull();
    expect(delivered.queryByTestId("shipment-detail-live-tracking-pending")).toBeNull();
  });

  it("le pasa al detalle el polling del placeholder", async () => {
    mockShipment({ carrierId: "carrier-1", status: ShipmentStatus.ASSIGNMENT_PENDING });
    await render(<ShipmentDetailScreen />);

    const options = mockUseShipment.mock.calls.at(-1)?.[1] as {
      refetchInterval: (data: ShipmentSummary | undefined) => number | false;
    };
    expect(options.refetchInterval(shipment({ carrierId: "carrier-1", status: ShipmentStatus.ASSIGNMENT_PENDING }))).toBe(30_000);
    expect(options.refetchInterval(shipment({ carrierId: "carrier-1", status: ShipmentStatus.IN_TRANSIT }))).toBe(false);
  });
});

describe("ShipmentDetailScreen — envío cancelado (MOVO-308)", () => {
  const HOLD = {
    id: "hold-1",
    shipmentId: "shipment-1",
    date: "2026-10-14T12:42:00.000Z",
    amountArs: 18500,
    status: "released",
    refundedAmountArs: null,
    card: { brand: "visa", last4: "4821" },
  };

  function cancelled(overrides: Partial<ShipmentSummary> = {}) {
    return shipment({
      status: ShipmentStatus.CANCELLED,
      carrierId: "carrier-1",
      agreedPriceArs: 18500,
      lastStatusChangedAt: "2026-10-15T17:32:00.000Z",
      ...overrides,
    });
  }

  function mockDetail(data: ShipmentSummary) {
    mockUseShipment.mockReturnValue({ isLoading: false, isError: false, error: null, refetch: jest.fn(), data });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseShipment.mockReset();
    mockCurrentUser.mockReset();
    mockUseShipmentHold.mockReturnValue({ data: undefined, refetch: jest.fn() });
    mockUseShipmentSettlement.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() });
  });

  it("emisor con penalidad cobrada: reservado, penalidad, tarjeta y lo liberado, sin la card de precio", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockDetail(cancelled({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: "captured" }));
    mockUseShipmentHold.mockReturnValue({ data: HOLD, refetch: jest.fn() });

    const { getByTestId, getByText, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(mockUseShipmentHold).toHaveBeenCalledWith("shipment-1", { enabled: true });
    expect(getByText("Reservado en tu tarjeta")).toBeTruthy();
    expect(getByTestId("shipment-detail-cancelled-payment-penalty")).toHaveTextContent("− $4.625");
    expect(getByTestId("shipment-detail-cancelled-payment-card")).toHaveTextContent("Visa •••• 4821");
    expect(getByText("Liberado en tu tarjeta")).toBeTruthy();
    expect(getByTestId("shipment-detail-cancelled-payment-released")).toHaveTextContent("$13.875");
    expect(getByTestId("shipment-detail-cancelled-payment-date")).toHaveTextContent(/Le avisamos a Tomás\./);
    expect(queryByTestId("shipment-detail-price")).toBeNull();
  });

  it("MOVO-318: en assigned con deuda en el hold, pide el hold y el sheet muestra el mismo monto reservado que 'Tu pago'", async () => {
    const holdWithDebt = { ...HOLD, status: "authorized", amountArs: 22200 };
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockDetail(shipment({ status: ShipmentStatus.ASSIGNED, carrierId: "carrier-1", agreedPriceArs: 18500 }));
    mockUseShipmentHold.mockReturnValue({ data: holdWithDebt, refetch: jest.fn() });
    mockCancellationQuote.mockResolvedValueOnce({
      penaltyArs: 4625,
      reason: "late_cancellation",
      freeUntil: "2026-10-16T11:00:00.000Z",
    });

    const { getByTestId, findByTestId, rerender } = await render(<ShipmentDetailScreen />);

    expect(mockUseShipmentHold).toHaveBeenCalledWith("shipment-1", { enabled: true });
    await fireEvent.press(getByTestId("shipment-detail-sender-actions-menu-action-cancel-shipment"));
    expect(await findByTestId("shipment-detail-sender-actions-cancel-sheet-penalty")).toHaveTextContent(
      "Se te cobrará $4.625 de los $22.200 reservados. El resto se libera en tu tarjeta.",
    );
    expect(getByTestId("shipment-detail-sender-actions-cancel-sheet-released-amount")).toHaveTextContent("$17.575");

    mockDetail(cancelled({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: "captured" }));
    rerender(<ShipmentDetailScreen />);
    expect(await findByTestId("shipment-detail-cancelled-payment-released")).toHaveTextContent("$17.575");
  });

  it("emisor con la penalidad como deuda: se liberó todo y explica el saldo pendiente", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockDetail(cancelled({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: "debt" }));
    mockUseShipmentHold.mockReturnValue({ data: HOLD, refetch: jest.fn() });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-cancelled-payment-penalty")).toHaveTextContent("$4.625");
    expect(getByTestId("shipment-detail-cancelled-payment-released")).toHaveTextContent("$18.500");
    expect(getByTestId("shipment-detail-cancelled-payment-note")).toHaveTextContent(/se suma a tu próximo pago/);
  });

  it("emisor con la penalidad en proceso: pill 'Procesando' y lo que se va a liberar", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockDetail(cancelled({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: "pending" }));
    mockUseShipmentHold.mockReturnValue({ data: HOLD, refetch: jest.fn() });

    const { getByTestId, getByText } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-cancelled-payment-pill")).toHaveTextContent("Procesando");
    expect(getByText("Se libera en tu tarjeta")).toBeTruthy();
  });

  it("emisor sin penalidad pero con reserva: 'Sin cargo' y se liberó todo", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockDetail(cancelled({ cancellationPenaltyArs: null, cancellationPenaltyStatus: null }));
    mockUseShipmentHold.mockReturnValue({ data: HOLD, refetch: jest.fn() });

    const { getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByTestId("shipment-detail-cancelled-payment-penalty")).toHaveTextContent("Sin cargo");
    expect(getByTestId("shipment-detail-cancelled-payment-released")).toHaveTextContent("$18.500");
  });

  it("emisor que nunca reservó: sin card de pago, sigue la card de precio", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockDetail(cancelled({ carrierId: null, agreedPriceArs: null }));
    mockUseShipmentHold.mockReturnValue({ data: null, refetch: jest.fn() });

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-cancelled-payment")).toBeNull();
    expect(getByTestId("shipment-detail-price")).toBeTruthy();
  });

  it("transportista: ve la compensación neta acreditada, no el 25 % ni el 'Recibís aprox.' del viaje", async () => {
    mockCurrentUser.mockReturnValue({ userId: "carrier-1" });
    mockDetail(cancelled({ cancellationPenaltyArs: 287.5, cancellationPenaltyStatus: "captured" }));
    mockUseShipmentSettlement.mockReturnValue({
      data: {
        shipmentId: "shipment-1",
        role: "carrier",
        kind: "cancellation_penalty",
        status: "credited",
        paidAmountArs: 287.5,
        debtCollectedArs: 0,
        paidAt: "2026-10-15T18:00:00.000Z",
        commissionArs: 150,
        mpFeeArs: 11.79,
        netAmountArs: 125.71,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByTestId, queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(mockUseShipmentSettlement).toHaveBeenCalledWith("shipment-1", expect.objectContaining({ enabled: true }));
    expect(getByTestId("shipment-detail-cancellation-compensation-net")).toHaveTextContent("$125,71");
    expect(getByTestId("shipment-detail-cancellation-compensation-pill")).toHaveTextContent("Acreditado");
    expect(queryByTestId("shipment-detail-price")).toBeNull();
  });

  it("transportista con la compensación en proceso: 'Recibís aprox.' estimado", async () => {
    mockCurrentUser.mockReturnValue({ userId: "carrier-1" });
    mockDetail(cancelled({ cancellationPenaltyArs: 287.5, cancellationPenaltyStatus: "pending" }));
    mockUseShipmentSettlement.mockReturnValue({
      data: {
        shipmentId: "shipment-1",
        role: "carrier",
        kind: "cancellation_penalty",
        status: "processing",
        paidAmountArs: 287.5,
        debtCollectedArs: 0,
        paidAt: null,
        commissionArs: 150,
        mpFeeArs: null,
        netAmountArs: null,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    const { getByText, getByTestId } = await render(<ShipmentDetailScreen />);

    expect(getByText("Recibís aprox.")).toBeTruthy();
    expect(getByTestId("shipment-detail-cancellation-compensation-pill")).toHaveTextContent("Cobrando");
  });

  it("transportista sin penalidad: sin card de compensación y con el precio pactado, no 'Recibís aprox.'", async () => {
    mockCurrentUser.mockReturnValue({ userId: "carrier-1" });
    mockDetail(cancelled());
    mockUseShipmentSettlement.mockReturnValue({ data: null, isLoading: false, isError: false, refetch: jest.fn() });

    const { queryByTestId, queryByText, getByText } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-cancellation-compensation")).toBeNull();
    expect(queryByTestId("shipment-detail-price")).toBeTruthy();
    expect(getByText("Precio pactado")).toBeTruthy();
    expect(queryByText("Recibís aprox.")).toBeNull();
  });
});
