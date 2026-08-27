import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import ShipmentDetailScreen from "../app/(app)/shipments/[id]";

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockCanGoBack = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({ id: "shipment-1" }),
}));

const mockUseShipment = jest.fn();
const mockAcceptMutation = { mutateAsync: jest.fn(), isPending: false };
const mockRejectMutation = { mutateAsync: jest.fn(), isPending: false };
const mockCancelMutation = { mutateAsync: jest.fn(), isPending: false };

jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
  useShipmentPhotos: () => ({ data: [], isLoading: false }),
  useShipmentRoute: () => ({ data: undefined }),
  useShipmentEvents: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
  useAcceptShipment: () => mockAcceptMutation,
  useRejectShipment: () => mockRejectMutation,
  useCancelShipment: () => mockCancelMutation,
}));

jest.mock("../src/hooks/use-offers", () => ({
  useShipmentOffers: () => ({ data: [], isLoading: false }),
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
jest.mock("../components/send/route-map-card", () => {
  const { View } = require("react-native");
  return { RouteMapCard: (props: { testID?: string }) => <View testID={props.testID} /> };
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
    expect(getByText("Receptor")).toBeTruthy();
    expect(getByTestId("shipment-detail-receiver")).toBeTruthy();
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

    expect(getByText("Emisor")).toBeTruthy();
    expect(getByTestId("shipment-detail-sender")).toBeTruthy();
    expect(getByText("Pedro Emisor")).toBeTruthy();
    expect(queryByTestId("shipment-detail-receiver")).toBeNull();
    expect(queryByText("Pend. de aceptar")).toBeNull();
    expect(queryByText("Aceptó el envío")).toBeNull();
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

    expect(getByText("Pend. de aceptar")).toBeTruthy();
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

    expect(getByText("Rechazó el envío")).toBeTruthy();
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
});

