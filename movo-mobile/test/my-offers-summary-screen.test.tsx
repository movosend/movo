import { fireEvent, render } from "@testing-library/react-native";
import MyOffersSummaryScreen from "../app/(app)/carrier/offers/index";
import type { MyOfferSummary } from "../src/api/offers-client";

const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockCanGoBack(),
  },
}));

const mockUseMyOffers = jest.fn();
jest.mock("../src/hooks/use-offers", () => ({
  useMyOffers: (...args: unknown[]) => mockUseMyOffers(...args),
}));

function offer(overrides: Partial<MyOfferSummary> = {}): MyOfferSummary {
  return {
    id: "offer-1",
    shipmentId: "shipment-1",
    carrierId: "carrier-1",
    priceOffered: 5000,
    priceNetArs: 4500,
    commissionAmountArs: 500,
    offeredDate: "2026-09-10",
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: null,
    carrierRatingAtOffer: null,
    carrierNameAtOffer: null,
    senderNameAtOffer: null,
    senderVerifiedAtOffer: null,
    senderRatingAtOffer: null,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    viewedAtBySender: null,
    status: "pending" as MyOfferSummary["status"],
    expiresAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    respondedAt: null,
    competitiveRank: null,
    shipment: {
      id: "shipment-1",
      status: "published",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupDate: "2026-09-10",
      pickupTimeWindowStart: "09:00",
      pickupTimeWindowEnd: "12:00",
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      distanceKm: 9.4,
      packageType: "small_box" as MyOfferSummary["shipment"]["packageType"],
      weightKg: 3,
      description: null,
    },
    ...overrides,
  };
}

function mockOffers(items: MyOfferSummary[]) {
  mockUseMyOffers.mockReturnValue({
    data: { items, page: 1, limit: 50, total: items.length },
    isLoading: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
  });
}

describe("MyOffersSummaryScreen (MOVO-151)", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra el hero de En juego/Confirmado con los totales NETOS (no el bruto)", async () => {
    mockOffers([
      offer({ id: "a", status: "pending" as MyOfferSummary["status"], priceOffered: 1200, priceNetArs: 1000 }),
      offer({
        id: "b",
        status: "accepted" as MyOfferSummary["status"],
        priceOffered: 2400,
        priceNetArs: 2000,
        shipmentId: "shipment-b",
      }),
    ]);

    const { getByTestId, getByText } = await render(<MyOffersSummaryScreen />);

    expect(getByTestId("my-offers-pending-total")).toHaveTextContent("$1.000");
    expect(getByTestId("my-offers-accepted-total")).toHaveTextContent("$2.000");
    expect(getByText("1 sin respuesta")).toBeTruthy();
  });

  it("Activas es la vista por defecto (AC4)", async () => {
    mockOffers([offer({ id: "p1" })]);
    const { getByTestId } = await render(<MyOffersSummaryScreen />);
    // El tab "Activas" existe y la card pending (líder, sin ranking) aparece en "El resto".
    expect(getByTestId("my-offers-tab-active")).toBeTruthy();
    expect(getByTestId("my-offers-active-p1")).toBeTruthy();
  });

  it("agrupa en 'Requieren algo tuyo' las aceptadas y las pendientes que no lideran, y el resto aparte", async () => {
    mockOffers([
      offer({ id: "accepted-1", status: "accepted" as MyOfferSummary["status"] }),
      offer({
        id: "losing-1",
        status: "pending" as MyOfferSummary["status"],
        competitiveRank: { rank: 3, total: 5, lowestPriceNetArs: 3000, highestPriceNetArs: 6000 },
      }),
      offer({
        id: "leading-1",
        status: "pending" as MyOfferSummary["status"],
        competitiveRank: { rank: 1, total: 3, lowestPriceNetArs: 4500, highestPriceNetArs: 6000 },
      }),
    ]);

    const { getByTestId, queryByTestId } = await render(<MyOffersSummaryScreen />);

    expect(getByTestId("my-offers-attention-accepted-1")).toBeTruthy();
    expect(getByTestId("my-offers-attention-losing-1")).toBeTruthy();
    expect(getByTestId("my-offers-attention-losing-1-notice")).toHaveTextContent(
      "Quedaste 3.º de 5. Bajando a $3.000 pasás al frente.",
    );
    expect(queryByTestId("my-offers-attention-leading-1")).toBeNull();
    expect(getByTestId("my-offers-active-leading-1")).toBeTruthy();
  });

  it("una oferta aceptada navega al envío ya asignado, no al detalle de la oferta (AC5)", async () => {
    mockOffers([offer({ id: "accepted-1", status: "accepted" as MyOfferSummary["status"], shipmentId: "shipment-9" })]);

    const { getByTestId } = await render(<MyOffersSummaryScreen />);
    await fireEvent.press(getByTestId("my-offers-attention-accepted-1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/transport/shipment-9");
  });

  it("una oferta pending navega al detalle de la oferta, donde vive retirar (AC6)", async () => {
    mockOffers([offer({ id: "p1" })]);

    const { getByTestId } = await render(<MyOffersSummaryScreen />);
    await fireEvent.press(getByTestId("my-offers-active-p1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/carrier/offers/p1");
  });

  it("el tab Cerradas agrupa rechazada/retirada/vencida/desplazada y el tab Activas las excluye", async () => {
    mockOffers([
      offer({ id: "p1" }),
      offer({ id: "r1", status: "rejected" as MyOfferSummary["status"] }),
      offer({ id: "w1", status: "withdrawn" as MyOfferSummary["status"] }),
    ]);

    const { getByTestId, queryByTestId } = await render(<MyOffersSummaryScreen />);

    expect(queryByTestId("my-offers-closed-r1")).toBeNull();

    await fireEvent.press(getByTestId("my-offers-tab-closed"));

    expect(getByTestId("my-offers-closed-r1")).toBeTruthy();
    expect(getByTestId("my-offers-closed-w1")).toBeTruthy();
    expect(queryByTestId("my-offers-active-p1")).toBeNull();
  });

  it("estado vacío sin ninguna oferta ofrece ir a Disponibles (AC7)", async () => {
    mockOffers([]);

    const { getByText, getByTestId } = await render(<MyOffersSummaryScreen />);

    expect(getByText("Todavía no ofertaste en ningún envío.")).toBeTruthy();
    await fireEvent.press(getByTestId("my-offers-empty-cta"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/(tabs)/transport");
  });

  it("estado vacío del tab Cerradas cuando todas las ofertas siguen activas", async () => {
    mockOffers([offer({ id: "p1" })]);

    const { getByTestId, getByText } = await render(<MyOffersSummaryScreen />);
    await fireEvent.press(getByTestId("my-offers-tab-closed"));

    expect(getByText("Todavía no tenés ofertas cerradas.")).toBeTruthy();
  });

  it("error con reintentar", async () => {
    const refetch = jest.fn();
    mockUseMyOffers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isRefetching: false,
      refetch,
    });

    const { getByTestId } = await render(<MyOffersSummaryScreen />);

    await fireEvent.press(getByTestId("my-offers-retry"));
    expect(refetch).toHaveBeenCalled();
  });
});
