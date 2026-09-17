import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { act, fireEvent, render } from "@testing-library/react-native";
import OfferDetailScreen from "../app/(app)/carrier/offers/[id]";
import type { MyOfferSummary } from "../src/api/offers-client";

// Mismo criterio que `test/sender-actions-bar.test.tsx`: el menú nativo real no
// tiene representación en el árbol de React -- el mock simula cada `action` como
// una fila tocable que dispara `onPressAction` con el mismo `nativeEvent.event`.
jest.mock("@react-native-menu/menu", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    MenuView: ({ testID, actions, onPressAction, onOpenMenu, children }: any) => (
      <View testID={testID}>
        <Pressable
          testID={`${testID}-open`}
          onPress={() => {
            onOpenMenu?.();
          }}
        >
          {children}
        </Pressable>
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

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({ id: "offer-1" }),
}));

const mockUseOfferDetail = jest.fn();
const mockMutateUpdate = jest.fn();
const mockMutateWithdraw = jest.fn();
let mockUpdatePending = false;
let mockUpdateError = false;
let mockWithdrawPending = false;

jest.mock("../src/hooks/use-offers", () => ({
  useOfferDetail: () => mockUseOfferDetail(),
  useUpdateOffer: () => ({
    mutate: mockMutateUpdate,
    isPending: mockUpdatePending,
    isError: mockUpdateError,
    error: mockUpdateError ? new Error("fail") : null,
  }),
  useWithdrawOffer: () => ({
    mutate: mockMutateWithdraw,
    isPending: mockWithdrawPending,
  }),
}));

function baseOffer(overrides: Partial<MyOfferSummary> = {}): MyOfferSummary {
  return {
    id: "offer-1",
    shipmentId: "shipment-1",
    carrierId: "carrier-1",
    priceOffered: 9200,
    offeredDate: "2026-09-19",
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: "Salgo temprano, tengo lugar en el baúl.",
    carrierRatingAtOffer: null,
    carrierNameAtOffer: null,
    priceNetArs: 8000,
    commissionAmountArs: 1200,
    senderNameAtOffer: "Pedro Yorlano",
    senderVerifiedAtOffer: true,
    senderRatingAtOffer: 4.9,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    viewedAtBySender: null,
    status: OfferStatus.PENDING,
    expiresAt: null,
    createdAt: "2026-09-17T12:00:00.000Z",
    respondedAt: null,
    shipment: {
      id: "shipment-1",
      status: "published",
      pickupAddress: "Paul Dirac 7777, Argüello",
      pickupDate: "2026-09-19",
      pickupTimeWindowStart: "12:00:00",
      pickupTimeWindowEnd: "18:00:00",
      deliveryAddress: "Las Mulitas 7565, Villa Belgrano",
      distanceKm: 9.4,
      packageType: "standard_package",
      weightKg: 2,
      description: null,
    },
    competitiveRank: null,
    ...overrides,
  };
}

describe("OfferDetailScreen (MOVO-182)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdatePending = false;
    mockUpdateError = false;
    mockWithdrawPending = false;
  });

  it("muestra el skeleton mientras carga", async () => {
    mockUseOfferDetail.mockReturnValue({ isLoading: true, data: undefined });
    const { getByTestId } = await render(<OfferDetailScreen />);
    expect(getByTestId("offer-detail-skeleton")).toBeTruthy();
  });

  it("un 404 se muestra como 'no existe'", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new ApiError(404, "OFFER_NOT_FOUND", "not found"),
      data: undefined,
      refetch: jest.fn(),
    });
    const { getByTestId } = await render(<OfferDetailScreen />);
    expect(getByTestId("offer-detail-error")).toHaveTextContent("Esta oferta no existe.");
  });

  it("oferta pending: banner de estado, ranking (con competitiveRank), CTA de precio y menú de más acciones", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({
        competitiveRank: { rank: 4, total: 5, lowestPriceNetArs: 7000, highestPriceNetArs: 9500 },
      }),
    });

    const { getByTestId, queryByTestId } = await render(<OfferDetailScreen />);

    expect(getByTestId("offer-detail-status-title")).toHaveTextContent("Esperando a Pedro");
    expect(getByTestId("offer-detail-net-amount")).toHaveTextContent("$8.000");
    expect(getByTestId("offer-detail-rank-section")).toBeTruthy();
    expect(getByTestId("offer-detail-change-price-cta")).toBeTruthy();
    expect(queryByTestId("offer-detail-modify-date-link")).toBeNull();
    expect(queryByTestId("offer-detail-withdraw-cta")).toBeNull();
    expect(getByTestId("offer-detail-menu")).toBeTruthy();
    expect(
      getByTestId("offer-detail-menu-action-modify-date"),
    ).toBeTruthy();
    expect(
      getByTestId("offer-detail-menu-action-withdraw-offer"),
    ).toBeTruthy();
  });

  it("la oferta usa la ventana del envío tal cual: comparación muestra 'Coincide'", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({
        offeredPickupTimeWindowStart: null,
        offeredPickupTimeWindowEnd: null,
      }),
    });

    const { getByTestId } = await render(<OfferDetailScreen />);
    expect(getByTestId("offer-detail-pickup-comparison")).toHaveTextContent(
      "Coincide con lo que pidió el emisor: sáb, 19 de septiembre · 12:00 a 18:00.",
    );
  });

  it("la oferta propone una franja alternativa: comparación muestra 'Es distinto'", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({
        offeredPickupTimeWindowStart: "08:00:00",
        offeredPickupTimeWindowEnd: "10:00:00",
      }),
    });

    const { getByTestId } = await render(<OfferDetailScreen />);
    expect(getByTestId("offer-detail-pickup-comparison")).toHaveTextContent(
      "Es distinto a lo que pidió el emisor: sáb, 19 de septiembre · 12:00 a 18:00.",
    );
  });

  it("sin competitiveRank, la sección 'Cómo venís' no se renderiza", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({ competitiveRank: null }),
    });

    const { queryByTestId } = await render(<OfferDetailScreen />);
    expect(queryByTestId("offer-detail-rank-section")).toBeNull();
  });

  it("'Cambiar el precio' abre la hoja con numpad, actualiza y muestra éxito", async () => {
    mockMutateUpdate.mockImplementation((_data, callbacks) => {
      callbacks?.onSuccess?.();
    });
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer(),
    });

    const { getByTestId, queryByTestId } = await render(<OfferDetailScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-change-price-cta"));
    });
    expect(getByTestId("offer-detail-price-draft-amount")).toHaveTextContent("9.200");

    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-price-key-del"));
      fireEvent.press(getByTestId("offer-detail-price-key-del"));
      fireEvent.press(getByTestId("offer-detail-price-key-del"));
      fireEvent.press(getByTestId("offer-detail-price-key-del"));
      fireEvent.press(getByTestId("offer-detail-price-key-8"));
      fireEvent.press(getByTestId("offer-detail-price-key-5"));
      fireEvent.press(getByTestId("offer-detail-price-key-0"));
      fireEvent.press(getByTestId("offer-detail-price-key-0"));
    });

    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-price-save"));
    });

    expect(mockMutateUpdate).toHaveBeenCalledWith(
      { priceOfferedArs: expect.any(Number) },
      expect.any(Object)
    );
    expect(queryByTestId("offer-detail-price-modal-backdrop")).toBeNull();
    expect(getByTestId("offer-detail-update-success")).toBeTruthy();
  });

  it("'Modificar fecha y horario' desde el menú navega a la pantalla de creación en modo edición", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer(),
    });

    const { getByTestId } = await render(<OfferDetailScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-menu-action-modify-date"));
    });

    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(app)/transport/shipment-1/offer?offerId=offer-1"
    );
  });

  it("'Retirar oferta' desde el menú abre el sheet de confirmación y al confirmar retira la oferta", async () => {
    mockMutateWithdraw.mockImplementation((_id, callbacks) => {
      callbacks?.onSuccess?.();
    });
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer(),
    });

    const { getByTestId, queryByTestId } = await render(<OfferDetailScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-menu-action-withdraw-offer"));
    });

    expect(getByTestId("offer-detail-withdraw-modal-backdrop")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-withdraw-confirm"));
    });

    expect(mockMutateWithdraw).toHaveBeenCalledWith("offer-1", expect.any(Object));
    expect(queryByTestId("offer-detail-withdraw-modal-backdrop")).toBeNull();
    expect(getByTestId("offer-detail-withdraw-success")).toBeTruthy();
  });

  it("'Retirar oferta': 'Volver' cierra el sheet sin retirar", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer(),
    });

    const { getByTestId, queryByTestId } = await render(<OfferDetailScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-menu-action-withdraw-offer"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-withdraw-dismiss"));
    });

    expect(mockMutateWithdraw).not.toHaveBeenCalled();
    expect(queryByTestId("offer-detail-withdraw-modal-backdrop")).toBeNull();
  });

  it("oferta accepted: sin acciones de pending, CTA 'Ver detalle del envío' navega al envío", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({ status: OfferStatus.ACCEPTED, respondedAt: "2026-09-18T09:00:00.000Z" }),
    });

    const { getByTestId, queryByTestId } = await render(<OfferDetailScreen />);

    expect(getByTestId("offer-detail-status-title")).toHaveTextContent("Te la aceptaron");
    expect(queryByTestId("offer-detail-change-price-cta")).toBeNull();
    expect(queryByTestId("offer-detail-withdraw-cta")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-go-to-shipment-cta"));
    });
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/transport/shipment-1");
  });

  it.each([
    [OfferStatus.REJECTED, "No la tomó"],
    [OfferStatus.WITHDRAWN, "La retiraste vos"],
    [OfferStatus.EXPIRED, "Venció sin respuesta"],
    [OfferStatus.SUPERSEDED, "El envío se cerró con otro transportista"],
  ])("oferta %s: solo lectura, sin acciones de pending/accepted", async (status, expectedTitle) => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({ status, respondedAt: "2026-09-18T09:00:00.000Z" }),
    });

    const { getByTestId, queryByTestId } = await render(<OfferDetailScreen />);

    expect(getByTestId("offer-detail-status-title")).toHaveTextContent(expectedTitle);
    expect(queryByTestId("offer-detail-change-price-cta")).toBeNull();
    expect(queryByTestId("offer-detail-withdraw-cta")).toBeNull();
    expect(queryByTestId("offer-detail-go-to-shipment-cta")).toBeNull();
    expect(getByTestId("offer-detail-see-similar-cta")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-menu-action-view-shipment"));
    });
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/transport/shipment-1");
  });

  it("oferta pending: el menú de más acciones también ofrece ver el detalle del envío", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({ status: OfferStatus.PENDING }),
    });

    const { getByTestId } = await render(<OfferDetailScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("offer-detail-menu-action-view-shipment"));
    });
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/transport/shipment-1");
  });

  it("oferta accepted: sin menú de más acciones (el CTA primario ya lleva al envío)", async () => {
    mockUseOfferDetail.mockReturnValue({
      isLoading: false,
      isError: false,
      data: baseOffer({ status: OfferStatus.ACCEPTED, respondedAt: "2026-09-18T09:00:00.000Z" }),
    });

    const { queryByTestId } = await render(<OfferDetailScreen />);

    expect(queryByTestId("offer-detail-menu")).toBeNull();
  });
});
