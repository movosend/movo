import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { RefreshControl } from "react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import ShipmentDetailScreen from "../app/(app)/shipments/[id]";
import { useCancelReceiverTransfer } from "../src/hooks/use-receiver-transfers";

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

    expect(getByText("Retiro programado")).toBeTruthy();
    expect(queryByText("Precio pactado")).toBeNull();
    expect(queryByText("Costo aproximado")).toBeNull();
    expect(queryByText("$5.000")).toBeNull();
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

  it("mirando como emisor en assigned (no cancelable), NO muestra ninguna barra de acciones (MOVO-29)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockUseShipment.mockReturnValue({
      isLoading: false,
      isError: false,
      data: shipment({ status: ShipmentStatus.ASSIGNED, carrierId: "carrier-1" }),
      error: null,
      refetch: jest.fn(),
    });

    const { queryByTestId } = await render(<ShipmentDetailScreen />);

    expect(queryByTestId("shipment-detail-sender-actions")).toBeNull();
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

    it("lo muestra al emisor junto al precio sugerido si highDemand es true", async () => {
      const { getByTestId, getByText } = await renderWith({ highDemand: true });

      expect(getByTestId("shipment-detail-high-demand")).toBeTruthy();
      expect(getByText("Costo aproximado")).toBeTruthy();
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
      "en assigned_unfunded el usuario %s ve un texto informativo sin botón",
      async (userId) => {
        mockCurrentUser.mockReturnValue({ userId });
        mockUseShipment.mockReturnValue({
          isLoading: false,
          isError: false,
          data: shipment({ carrierId: CARRIER, status: ShipmentStatus.ASSIGNED_UNFUNDED }),
          error: null,
          refetch: jest.fn(),
        });

        const { getByText, queryByTestId } = await render(<ShipmentDetailScreen />);

        expect(queryByTestId("shipment-detail-cta")).toBeNull();
        expect(getByText("Los fondos se reservan antes del retiro.")).toBeTruthy();
      },
    );

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
      ["user-2", "Te queda", "$5.000"],
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
      expect(
        getByText("Cuando el transportista inicie el recorrido, vas a poder ver su ubicación en tiempo real."),
      ).toBeTruthy();
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
    asCarrier.unmount();

    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockShipment({ carrierId: null, status: ShipmentStatus.PUBLISHED });
    const withoutCarrier = await render(<ShipmentDetailScreen />);
    expect(withoutCarrier.queryByTestId("shipment-detail-live-tracking-pending")).toBeNull();
    withoutCarrier.unmount();

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
