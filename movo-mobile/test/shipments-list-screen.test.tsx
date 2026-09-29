import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import MyShipmentsScreen from "../app/(app)/shipments/index";

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  router: {
    back: () => mockRouterBack(),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    canGoBack: () => mockCanGoBack(),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

const mockUseMyShipments = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useMyShipments: () => mockUseMyShipments(),
}));

const NAMES: Record<string, string> = {
  ana: "Ana López",
  martin: "Martín Sosa",
  juan: "Juan Pérez",
  paul: "Paul Díaz",
};
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfiles: (ids: string[]) => ids.map((id) => ({ data: { fullName: NAMES[id] } })),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector?: (state: { user: { userId: string } | null }) => unknown) => {
    const state = { user: { userId: "me" } };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "shipment-1",
    senderId: "me",
    receiverId: "ana",
    carrierId: null,
    packageType: "standard_package",
    weightKg: 2,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Don Bosco 4807, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Rivadavia 387, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2030-01-05",
    pickupTimeWindowStart: "09:00:00",
    pickupTimeWindowEnd: "12:00:00",
    suggestedPriceArs: 4500,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.PUBLISHED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    pendingOffersCount: 0,
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

const WITH_OFFERS = shipment({ id: "with-offers", pendingOffersCount: 3, pickupDate: "2030-01-06" });
const TO_ACCEPT = shipment({
  id: "to-accept",
  senderId: "martin",
  receiverId: "me",
  status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
  pendingOffersCount: null,
  pickupDate: "2030-01-07",
});
const IN_TRANSIT = shipment({
  id: "in-transit",
  status: ShipmentStatus.IN_TRANSIT,
  agreedPriceArs: 8467,
  pendingOffersCount: null,
  pickupDate: "2030-01-01",
  deliveryAddress: "Jujuy 455, Córdoba",
});
const REJECTED = shipment({
  id: "rejected",
  receiverId: "paul",
  status: ShipmentStatus.REJECTED_BY_RECEIVER,
  receiverRedesignationDeadline: "2099-01-01T12:00:00.000Z",
  pendingOffersCount: null,
  pickupDate: "2030-01-08",
});
// Cierres en el año en curso: el encabezado del mes no lleva año ("Septiembre").
const YEAR = new Date().getFullYear();
const DELIVERED = shipment({
  id: "delivered",
  receiverId: "juan",
  status: ShipmentStatus.DELIVERED,
  pendingOffersCount: null,
  lastStatusChangedAt: `${YEAR}-09-24T15:00:00.000Z`,
});
const CANCELLED = shipment({
  id: "cancelled",
  senderId: "martin",
  receiverId: "me",
  status: ShipmentStatus.CANCELLED,
  pendingOffersCount: null,
  lastStatusChangedAt: `${YEAR}-08-22T15:00:00.000Z`,
});

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

const ALL = [IN_TRANSIT, WITH_OFFERS, TO_ACCEPT, REJECTED, DELIVERED, CANCELLED];

async function renderWith(items: ShipmentSummary[] = ALL) {
  mockUseMyShipments.mockReturnValue(baseResult({ data: pages(items) }));
  return render(<MyShipmentsScreen />);
}

function rowIds(getAllByTestId: (id: RegExp) => Array<{ props: Record<string, unknown> }>) {
  return getAllByTestId(/^my-shipments-row-/)
    .map((n) => String(n.props.testID).replace("my-shipments-row-", ""))
    .filter((id) => !/-(pill|strip|quiet)$/.test(id));
}

// MOVO-257: rediseño de "Mis envíos" sobre el prototipo "Mis envíos 4a".
describe("MyShipmentsScreen", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra el skeleton mientras carga, sin filas", async () => {
    mockUseMyShipments.mockReturnValue(baseResult({ isLoading: true }));
    const { queryAllByTestId } = await render(<MyShipmentsScreen />);
    expect(queryAllByTestId(/^my-shipments-row-/)).toHaveLength(0);
  });

  it("muestra el estado de error con reintentar", async () => {
    const refetch = jest.fn();
    mockUseMyShipments.mockReturnValue(baseResult({ isError: true, refetch }));
    const { getByText } = await render(<MyShipmentsScreen />);
    expect(getByText("No pudimos cargar tus envíos.")).toBeTruthy();
    await act(async () => fireEvent.press(getByText("Reintentar")));
    expect(refetch).toHaveBeenCalled();
  });

  it("las tarjetas de rol cuentan los activos y marcan cuando alguno requiere acción", async () => {
    const { getByTestId } = await renderWith();
    expect(within(getByTestId("my-shipments-role-sending")).getByText("3 activos")).toBeTruthy();
    expect(within(getByTestId("my-shipments-role-receiving")).getByText("1 activo")).toBeTruthy();
    expect(getByTestId("my-shipments-role-sending-dot")).toBeTruthy();
    expect(getByTestId("my-shipments-role-receiving-dot")).toBeTruthy();
  });

  it("En curso lista primero lo que requiere acción y después por fecha de retiro", async () => {
    const { getAllByTestId, getByText } = await renderWith();
    expect(rowIds(getAllByTestId)).toEqual(["with-offers", "to-accept", "rejected", "in-transit"]);
    expect(getByText("4 en curso")).toBeTruthy();
  });

  it("cada fila muestra título por rol, precio y su franja", async () => {
    const { getByTestId } = await renderWith();
    const offers = within(getByTestId("my-shipments-row-with-offers"));
    expect(offers.getByText("Rivadavia 387")).toBeTruthy();
    expect(offers.getByText("3 OFERTAS")).toBeTruthy();
    expect(offers.getByText("aprox.")).toBeTruthy();
    expect(offers.getByText("Tenés 3 ofertas. Elegí quién lo lleva.")).toBeTruthy();

    const accept = within(getByTestId("my-shipments-row-to-accept"));
    expect(accept.getByText("Av. Don Bosco 4807")).toBeTruthy();
    expect(accept.getByText("Martín te manda un paquete. Aceptalo.")).toBeTruthy();

    const transit = within(getByTestId("my-shipments-row-in-transit"));
    expect(transit.getByText("EN CAMINO")).toBeTruthy();
    expect(transit.getByText("pactado")).toBeTruthy();
  });

  it("la franja lleva a la pantalla donde se resuelve y la fila al detalle", async () => {
    const { getByTestId } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-row-with-offers-strip")));
    expect(mockRouterPush).toHaveBeenLastCalledWith("/shipments/with-offers/offers");
    await act(async () => fireEvent.press(getByTestId("my-shipments-row-rejected-strip")));
    expect(mockRouterPush).toHaveBeenLastCalledWith("/shipments/rejected/change-receiver");
    await act(async () => fireEvent.press(getByTestId("my-shipments-row-in-transit")));
    expect(mockRouterPush).toHaveBeenLastCalledWith("/shipments/in-transit");
  });

  it("tocar una tarjeta de rol filtra, oculta el tag de rol y cambia el título; tocarla de nuevo vuelve a todos", async () => {
    const { getByTestId, getAllByTestId, getByText, queryByText } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-role-receiving")));
    expect(rowIds(getAllByTestId)).toEqual(["to-accept"]);
    expect(getByText("1 que recibís")).toBeTruthy();
    expect(queryByText("RECIBÍS")).toBeNull();

    await act(async () => fireEvent.press(getByTestId("my-shipments-role-receiving")));
    expect(getByText("4 en curso")).toBeTruthy();
  });

  it("Historial agrupa por mes de cierre, más reciente primero", async () => {
    const { getByTestId, getAllByTestId, getByText } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-stage-history")));
    expect(rowIds(getAllByTestId)).toEqual(["delivered", "cancelled"]);
    expect(getByText("Septiembre")).toBeTruthy();
    expect(getByText("Agosto")).toBeTruthy();
    expect(within(getByTestId("my-shipments-row-delivered")).getByText(/^\S{3} 24 · Enviás$/)).toBeTruthy();
    expect(within(getByTestId("my-shipments-row-cancelled")).getByText("CANCELADO")).toBeTruthy();
  });

  it("el filtro de Persona muestra una etiqueta que se saca con un toque", async () => {
    const { getByTestId, getAllByTestId, queryByTestId } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-filter-open")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-person-option-ana")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-apply")));

    expect(rowIds(getAllByTestId)).toEqual(["with-offers", "in-transit"]);
    expect(getByTestId("my-shipments-filter-dot")).toBeTruthy();

    await act(async () => fireEvent.press(getByTestId("my-shipments-active-filter-person")));
    expect(rowIds(getAllByTestId)).toHaveLength(4);
    expect(queryByTestId("my-shipments-filter-dot")).toBeNull();
  });

  it("el filtro de Persona busca también a quien te envía, no solo al destinatario", async () => {
    const { getByTestId, getAllByTestId } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-filter-open")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-person-option-martin")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-apply")));
    expect(rowIds(getAllByTestId)).toEqual(["to-accept"]);
  });

  it("cambiar de pestaña conserva la persona y borra el estado", async () => {
    const { getByTestId, getAllByTestId, queryByTestId } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-filter-open")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-person-option-martin")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-status-option-accept")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-apply")));
    expect(getByTestId("my-shipments-active-filter-status")).toBeTruthy();

    await act(async () => fireEvent.press(getByTestId("my-shipments-stage-history")));
    expect(queryByTestId("my-shipments-active-filter-status")).toBeNull();
    expect(getByTestId("my-shipments-active-filter-person")).toBeTruthy();
    expect(rowIds(getAllByTestId)).toEqual(["cancelled"]);
  });

  it("cambiar de rol borra la persona si no aparece en el rol nuevo", async () => {
    const { getByTestId, queryByTestId } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-filter-open")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-person-option-martin")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-apply")));

    await act(async () => fireEvent.press(getByTestId("my-shipments-role-sending")));
    expect(queryByTestId("my-shipments-active-filter-person")).toBeNull();
  });

  it("sin resultados por filtro ofrece quitar los filtros", async () => {
    const { getByTestId, getByText, getAllByTestId } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-filter-open")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-person-option-martin")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-status-option-in_transit")));
    await act(async () => fireEvent.press(getByTestId("shipments-filter-apply")));
    expect(getByText("No hay envíos con ese filtro.")).toBeTruthy();

    await act(async () => fireEvent.press(getByTestId("my-shipments-clear-filter")));
    expect(rowIds(getAllByTestId)).toHaveLength(4);
  });

  it("muestra el estado vacío de En curso", async () => {
    const { getByText } = await renderWith([DELIVERED]);
    expect(getByText("No tenés envíos en curso.")).toBeTruthy();
  });

  it("muestra el estado vacío de Historial", async () => {
    const { getByText, getByTestId } = await renderWith([IN_TRANSIT]);
    await act(async () => fireEvent.press(getByTestId("my-shipments-stage-history")));
    expect(getByText("Todavía no tenés envíos en tu historial.")).toBeTruthy();
  });

  it("el botón de volver sale de la pantalla, o vuelve a Inicio sin historial", async () => {
    const { getByTestId } = await renderWith();
    await act(async () => fireEvent.press(getByTestId("my-shipments-back")));
    expect(mockRouterBack).toHaveBeenCalled();

    mockCanGoBack.mockReturnValueOnce(false);
    await act(async () => fireEvent.press(getByTestId("my-shipments-back")));
    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/(tabs)/home");
  });
});
