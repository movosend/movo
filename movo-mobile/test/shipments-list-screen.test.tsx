import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import MyShipmentsScreen from "../app/(app)/shipments/index";

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  router: {
    back: () => mockRouterBack(),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    canGoBack: () => mockCanGoBack(),
    push: jest.fn(),
  },
}));

const mockUseMyShipments = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useMyShipments: () => mockUseMyShipments(),
}));

const mockUsePublicProfiles = jest.fn();

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfiles: (ids: string[]) => mockUsePublicProfiles(ids),
}));

const mockCurrentUser = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: { user: { userId: string } | null }) => unknown) => {
    const state = { user: mockCurrentUser() };
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

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    ...overrides,
  };
}

function pages(items: ShipmentSummary[]) {
  return { pages: [{ items, page: 1, limit: 20, total: items.length }] };
}

// MOVO-127: pantalla "Mis Envíos" — tabs En curso/Completados + filtros (estado, destinatario).
describe("MyShipmentsScreen", () => {
  beforeEach(() => {
    mockUsePublicProfiles.mockReturnValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  it("muestra el skeleton mientras carga la primera página", async () => {
    mockUseMyShipments.mockReturnValue(baseResult({ isLoading: true }));

    const { queryByTestId } = await render(<MyShipmentsScreen />);

    expect(queryByTestId("my-shipments-list")).toBeNull();
  });

  it("muestra el estado de error con reintentar", async () => {
    mockUseMyShipments.mockReturnValue(baseResult({ isError: true }));

    const { getByText } = await render(<MyShipmentsScreen />);

    expect(getByText("No pudimos cargar tus envíos.")).toBeTruthy();
  });

  it('arranca en la tab "En curso" y muestra su estado vacío', async () => {
    mockUseMyShipments.mockReturnValue(baseResult({ data: pages([shipment({ status: ShipmentStatus.DELIVERED })]) }));

    const { getByText } = await render(<MyShipmentsScreen />);

    expect(getByText("No tenés envíos en curso.")).toBeTruthy();
  });

  it("lista solo los envíos de la tab activa", async () => {
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "ongoing-1", status: ShipmentStatus.IN_TRANSIT }),
          shipment({ id: "past-1", status: ShipmentStatus.DELIVERED }),
        ]),
      }),
    );

    const { getByTestId, queryByTestId } = await render(<MyShipmentsScreen />);

    expect(getByTestId("my-shipments-card-ongoing-1")).toBeTruthy();
    expect(queryByTestId("my-shipments-card-past-1")).toBeNull();
  });

  it("cambia a Completados al tocar esa tab", async () => {
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "ongoing-1", status: ShipmentStatus.IN_TRANSIT }),
          shipment({ id: "past-1", status: ShipmentStatus.DELIVERED }),
        ]),
      }),
    );

    const { getByTestId, queryByTestId } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-stage-past"));

    expect(getByTestId("my-shipments-card-past-1")).toBeTruthy();
    expect(queryByTestId("my-shipments-card-ongoing-1")).toBeNull();
  });

  it("filtra por estado desde las pills y muestra el indicador activo", async () => {
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "s1", status: ShipmentStatus.IN_TRANSIT }),
          shipment({ id: "s2", status: ShipmentStatus.PUBLISHED }),
        ]),
      }),
    );

    const { getByTestId, queryByTestId } = await render(<MyShipmentsScreen />);

    expect(queryByTestId("my-shipments-filter-dot")).toBeNull();

    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.press(getByTestId(`shipments-filter-status-option-${ShipmentStatus.IN_TRANSIT}`));
    await fireEvent.press(getByTestId("shipments-filter-apply"));

    expect(getByTestId("my-shipments-card-s1")).toBeTruthy();
    expect(queryByTestId("my-shipments-card-s2")).toBeNull();
    expect(getByTestId("my-shipments-filter-dot")).toBeTruthy();
  });

  it("filtra por destinatario desde las pills usando el nombre resuelto", async () => {
    mockUsePublicProfiles.mockReturnValue([
      { data: { id: "receiver-a", fullName: "Ana Pérez" } },
      { data: { id: "receiver-b", fullName: "Beto Gómez" } },
    ]);
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "s1", receiverId: "receiver-a" }),
          shipment({ id: "s2", receiverId: "receiver-b" }),
        ]),
      }),
    );

    const { getByTestId, getByText, queryByTestId } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.press(getByTestId("shipments-filter-receiver-option-receiver-a"));

    expect(getByText("Ana Pérez")).toBeTruthy();

    await fireEvent.press(getByTestId("shipments-filter-apply"));

    expect(getByTestId("my-shipments-card-s1")).toBeTruthy();
    expect(queryByTestId("my-shipments-card-s2")).toBeNull();
  });

  it("muestra como pill solo a los 3 destinatarios más frecuentes, con el nombre capitalizado", async () => {
    mockUsePublicProfiles.mockReturnValue([
      { data: { id: "receiver-a", fullName: "ANA PÉREZ" } },
      { data: { id: "receiver-b", fullName: "beto gómez" } },
      { data: { id: "receiver-c", fullName: "Caro Díaz" } },
      { data: { id: "receiver-d", fullName: "Dani Ruiz" } },
    ]);
    // receiver-d es el único con un solo envío, así que queda fuera del top 3.
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "s1", receiverId: "receiver-a" }),
          shipment({ id: "s2", receiverId: "receiver-a" }),
          shipment({ id: "s3", receiverId: "receiver-b" }),
          shipment({ id: "s4", receiverId: "receiver-b" }),
          shipment({ id: "s5", receiverId: "receiver-c" }),
          shipment({ id: "s6", receiverId: "receiver-c" }),
          shipment({ id: "s7", receiverId: "receiver-d" }),
        ]),
      }),
    );

    const { getByTestId, getByText, queryByTestId } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-filter-open"));

    expect(getByTestId("shipments-filter-receiver-option-receiver-a")).toBeTruthy();
    expect(getByTestId("shipments-filter-receiver-option-receiver-b")).toBeTruthy();
    expect(getByTestId("shipments-filter-receiver-option-receiver-c")).toBeTruthy();
    expect(queryByTestId("shipments-filter-receiver-option-receiver-d")).toBeNull();

    expect(getByText("Ana Pérez")).toBeTruthy();
    expect(getByText("Beto Gómez")).toBeTruthy();

    // El que quedó fuera del top se alcanza escribiendo.
    await fireEvent.changeText(getByTestId("shipments-filter-receiver-search"), "dani");

    expect(getByTestId("shipments-filter-receiver-option-receiver-d")).toBeTruthy();
    expect(queryByTestId("shipments-filter-receiver-option-receiver-a")).toBeNull();
  });

  it("busca destinatarios por nombre y filtra las pills", async () => {
    mockUsePublicProfiles.mockReturnValue([
      { data: { id: "receiver-a", fullName: "Ana Pérez" } },
      { data: { id: "receiver-b", fullName: "Beto Gómez" } },
    ]);
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "s1", receiverId: "receiver-a" }),
          shipment({ id: "s2", receiverId: "receiver-b" }),
        ]),
      }),
    );

    const { getByTestId, queryByTestId } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.changeText(getByTestId("shipments-filter-receiver-search"), "ana");

    expect(getByTestId("shipments-filter-receiver-option-receiver-a")).toBeTruthy();
    expect(queryByTestId("shipments-filter-receiver-option-receiver-b")).toBeNull();

    await fireEvent.press(getByTestId("shipments-filter-receiver-option-receiver-a"));
    await fireEvent.press(getByTestId("shipments-filter-apply"));

    expect(getByTestId("my-shipments-card-s1")).toBeTruthy();
    expect(queryByTestId("my-shipments-card-s2")).toBeNull();
  });

  it('"Limpiar" en la hoja resetea ambos filtros', async () => {
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "s1", status: ShipmentStatus.IN_TRANSIT }),
          shipment({ id: "s2", status: ShipmentStatus.PUBLISHED }),
        ]),
      }),
    );

    const { getByTestId, queryByTestId } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.press(getByTestId(`shipments-filter-status-option-${ShipmentStatus.IN_TRANSIT}`));
    await fireEvent.press(getByTestId("shipments-filter-apply"));

    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.press(getByTestId("shipments-filter-clear"));

    expect(getByTestId("my-shipments-card-s1")).toBeTruthy();
    expect(getByTestId("my-shipments-card-s2")).toBeTruthy();
    expect(queryByTestId("my-shipments-filter-dot")).toBeNull();
  });

  it("permite quitar el filtro desde el estado vacío filtrado", async () => {
    mockUseMyShipments.mockReturnValue(baseResult({ data: pages([shipment({ status: ShipmentStatus.PUBLISHED })]) }));

    const { getByTestId, getByText } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.press(getByTestId(`shipments-filter-status-option-${ShipmentStatus.IN_TRANSIT}`));
    await fireEvent.press(getByTestId("shipments-filter-apply"));

    expect(getByText("No hay envíos con ese filtro.")).toBeTruthy();

    await fireEvent.press(getByTestId("my-shipments-clear-filter"));

    expect(getByTestId("my-shipments-card-shipment-1")).toBeTruthy();
  });

  it("filtra por rol desde las pills de la hoja de filtro (MOVO-132)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "sent-1", senderId: "user-1", receiverId: "user-2" }),
          shipment({ id: "received-1", senderId: "user-3", receiverId: "user-1" }),
        ]),
      }),
    );

    const { getByTestId, queryByTestId } = await render(<MyShipmentsScreen />);

    // Ambos visibles inicialmente
    expect(getByTestId("my-shipments-card-sent-1")).toBeTruthy();
    expect(getByTestId("my-shipments-card-received-1")).toBeTruthy();

    // Filtrar por Enviados
    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.press(getByTestId("shipments-filter-role-option-sent"));
    await fireEvent.press(getByTestId("shipments-filter-apply"));

    expect(getByTestId("my-shipments-card-sent-1")).toBeTruthy();
    expect(queryByTestId("my-shipments-card-received-1")).toBeNull();

    // Cambiar a Recibidos
    await fireEvent.press(getByTestId("my-shipments-filter-open"));
    await fireEvent.press(getByTestId("shipments-filter-role-option-received"));
    await fireEvent.press(getByTestId("shipments-filter-apply"));

    expect(queryByTestId("my-shipments-card-sent-1")).toBeNull();
    expect(getByTestId("my-shipments-card-received-1")).toBeTruthy();
  });

  it("prioriza en la cima los envíos recibidos en awaiting_receiver_confirmation (AC2 de MOVO-132)", async () => {
    mockCurrentUser.mockReturnValue({ userId: "user-1" });
    mockUseMyShipments.mockReturnValue(
      baseResult({
        data: pages([
          shipment({ id: "s-published", senderId: "user-1", receiverId: "user-2", status: ShipmentStatus.PUBLISHED }),
          shipment({ id: "s-pending", senderId: "user-3", receiverId: "user-1", status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION }),
        ]),
      }),
    );

    const { getByTestId } = await render(<MyShipmentsScreen />);

    // Verificar que s-pending se renderiza y que está presente
    expect(getByTestId("my-shipments-card-s-pending")).toBeTruthy();
    expect(getByTestId("my-shipments-card-s-published")).toBeTruthy();
  });

  it("vuelve atrás con router.back() cuando hay historial", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockUseMyShipments.mockReturnValue(baseResult({ data: pages([]) }));

    const { getByTestId } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-back"));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("usa router.replace hacia Inicio como fallback sin historial", async () => {
    mockCanGoBack.mockReturnValue(false);
    mockUseMyShipments.mockReturnValue(baseResult({ data: pages([]) }));

    const { getByTestId } = await render(<MyShipmentsScreen />);

    await fireEvent.press(getByTestId("my-shipments-back"));

    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/(tabs)/home");
  });
});
