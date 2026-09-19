import { fireEvent, render } from "@testing-library/react-native";
import MyOffersSummaryScreen from "../app/(app)/carrier/offers/index";

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

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: "offer-1",
    shipmentId: "shipment-1",
    carrierId: "carrier-1",
    priceOffered: 4500,
    offeredDate: "2026-09-10",
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: null,
    carrierRatingAtOffer: null,
    carrierNameAtOffer: null,
    status: "pending",
    expiresAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    respondedAt: null,
    shipment: {
      id: "shipment-1",
      status: "published",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupDate: "2026-09-10",
      deliveryAddress: "Bv. San Juan 500, Córdoba",
    },
    ...overrides,
  };
}

describe("MyOffersSummaryScreen (MOVO-183)", () => {
  afterEach(() => jest.clearAllMocks());

  it("muestra el hero de En juego/Confirmado con los totales reales", async () => {
    mockUseMyOffers.mockReturnValue({
      data: {
        items: [
          offer({ id: "a", status: "pending", priceOffered: 1000 }),
          offer({ id: "b", status: "accepted", priceOffered: 2000, shipmentId: "shipment-b" }),
          offer({ id: "c", status: "accepted", priceOffered: 3000, shipmentId: "shipment-c" }),
        ],
        page: 1,
        limit: 50,
        total: 2,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    });

    const { getByText, getByTestId } = await render(<MyOffersSummaryScreen />);

    expect(getByTestId("my-offers-pending-total")).toHaveTextContent("$1.000");
    expect(getByTestId("my-offers-accepted-total")).toHaveTextContent("$5.000"); // 2000 + 3000 confirmado
    expect(getByText("1 sin respuesta")).toBeTruthy();
  });

  it("lista las ofertas aceptadas bajo 'Requieren algo tuyo' y navega al detalle", async () => {
    mockUseMyOffers.mockReturnValue({
      data: { items: [offer({ id: "accepted-1", status: "accepted" })], page: 1, limit: 50, total: 1 },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    });

    const { getByTestId } = await render(<MyOffersSummaryScreen />);

    await fireEvent.press(getByTestId("my-offers-accepted-accepted-1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/transport/shipment-1");
  });

  it("lista TODAS las ofertas propias, sin importar estado, y navega al detalle de la oferta", async () => {
    mockUseMyOffers.mockReturnValue({
      data: {
        items: [
          offer({ id: "p1", status: "pending", createdAt: "2026-09-01T10:00:00.000Z" }),
          offer({ id: "r1", status: "rejected", createdAt: "2026-09-05T10:00:00.000Z" }),
          offer({ id: "w1", status: "withdrawn", createdAt: "2026-09-03T10:00:00.000Z" }),
        ],
        page: 1,
        limit: 50,
        total: 3,
      },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    });

    const { getByText, getByTestId } = await render(<MyOffersSummaryScreen />);

    expect(getByText("Todas tus ofertas (3)")).toBeTruthy();

    await fireEvent.press(getByTestId("my-offers-row-r1"));

    expect(mockRouterPush).toHaveBeenCalledWith("/carrier/offers/r1");
  });

  it("estado vacío sin ninguna oferta", async () => {
    mockUseMyOffers.mockReturnValue({
      data: { items: [], page: 1, limit: 50, total: 0 },
      isLoading: false,
      isError: false,
      isRefetching: false,
      refetch: jest.fn(),
    });

    const { getByText } = await render(<MyOffersSummaryScreen />);

    expect(getByText("Todavía no ofertaste en ningún envío.")).toBeTruthy();
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
