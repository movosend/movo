import { act, fireEvent, render } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import ShipmentOffersScreen from "../app/(app)/shipments/[id]/offers";
import type { OfferSummary } from "../src/api/offers-client";

const mockUseShipmentOffers = jest.fn();
const mockMutateAccept = jest.fn();
const mockMutateReject = jest.fn();
const mockRefetchOffers = jest.fn();
const mockRefetchShipment = jest.fn();
const mockUsePublicProfile = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    push: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: jest.fn(),
}));

jest.mock("../src/hooks/use-offers", () => ({
  useShipmentOffers: (...args: unknown[]) => mockUseShipmentOffers(...args),
  useAcceptOffer: () => ({
    mutateAsync: mockMutateAccept,
    isPending: false,
  }),
  useRejectOffer: () => ({
    mutateAsync: mockMutateReject,
    isPending: false,
  }),
}));

jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => ({
    refetch: mockRefetchShipment,
  }),
}));

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => mockUsePublicProfile(),
}));

describe("ShipmentOffersScreen", () => {
  const sampleOffer1: OfferSummary = {
    id: "off-1",
    shipmentId: "ship-1",
    carrierId: "carr-1",
    priceOffered: 12000,
    offeredDate: "2026-09-01T10:00:00.000Z",
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: "Llego temprano",
    carrierRatingAtOffer: 4.9,
    carrierNameAtOffer: "Lucas Transportista",
    status: OfferStatus.PENDING,
    expiresAt: null,
    createdAt: "2026-08-25T10:00:00.000Z",
    respondedAt: null,
  };

  const sampleOffer2: OfferSummary = {
    id: "off-2",
    shipmentId: "ship-1",
    carrierId: "carr-2",
    priceOffered: 10000,
    offeredDate: "2026-09-02T10:00:00.000Z",
    offeredPickupTimeWindowStart: null,
    offeredPickupTimeWindowEnd: null,
    message: null,
    carrierRatingAtOffer: null,
    carrierNameAtOffer: "Marta Conductora",
    status: OfferStatus.PENDING,
    expiresAt: null,
    createdAt: "2026-08-25T11:00:00.000Z",
    respondedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: "ship-1" });
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "carr-1",
        fullName: "Lucas Transportista",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 0, asCarrier: 15 },
        reputationScore: 4.9,
      },
      isLoading: false,
      isError: false,
    });
  });

  it("renderiza skeleton mientras carga", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByTestId } = await render(<ShipmentOffersScreen />);

    expect(getByTestId("offers-skeleton")).toBeTruthy();
  });

  it("renderiza error y botón reintentar ante fallo de carga", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByTestId } = await render(<ShipmentOffersScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("offers-retry-btn"));
    });
    expect(mockRefetchOffers).toHaveBeenCalled();
  });

  it("renderiza mensaje personalizado para el receptor o no-emisor cuando la API responde 403", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(403, "AUTH_FORBIDDEN", "Solo el emisor del envío puede ver sus ofertas."),
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByText } = await render(<ShipmentOffersScreen />);

    expect(getByText("Esta sección solo está disponible para el emisor del envío.")).toBeTruthy();
  });

  it("renderiza estado vacío explicativo cuando no hay ofertas", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByText, getByTestId } = await render(<ShipmentOffersScreen />);

    expect(getByText("Todavía no recibiste ofertas")).toBeTruthy();
    expect(getByTestId("offers-empty-state")).toBeTruthy();
  });

  it("renderiza la lista de ofertas recibidas", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1, sampleOffer2],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByText, getByTestId } = await render(<ShipmentOffersScreen />);

    expect(getByText("Lucas Transportista")).toBeTruthy();
    expect(getByText("Marta Conductora")).toBeTruthy();
    expect(getByTestId("offer-card-off-1")).toBeTruthy();
    expect(getByTestId("offer-card-off-2")).toBeTruthy();
  });

  it("cambia el criterio de ordenamiento al tocar los botones de sort", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByTestId } = await render(<ShipmentOffersScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("sort-by-rating"));
    });
    expect(mockUseShipmentOffers).toHaveBeenCalledWith("ship-1", { sort: "rating" });

    await act(async () => {
      fireEvent.press(getByTestId("sort-by-price"));
    });
    expect(mockUseShipmentOffers).toHaveBeenCalledWith("ship-1", { sort: "price" });
  });

  it("abre el sheet de perfil del transportista al tocar su cabecera", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByTestId, getByText } = await render(<ShipmentOffersScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-carrier-pressable"));
    });

    expect(getByText("Perfil del transportista")).toBeTruthy();
  });

  it("flujo completo de elección de oferta con confirmación y éxito", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    mockMutateAccept.mockResolvedValueOnce({
      ...sampleOffer1,
      status: OfferStatus.ACCEPTED,
    });

    const { getByTestId, getByText } = await render(<ShipmentOffersScreen />);

    // 1. Presionar "Elegir"
    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-accept-btn"));
    });

    // 2. Verifica que se abrió el modal de confirmación
    expect(getByText("¿Elegir esta oferta?")).toBeTruthy();

    // 3. Confirmar elección
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-modal-confirm-btn"));
    });

    expect(mockMutateAccept).toHaveBeenCalledWith("off-1");

    // 4. Modal de éxito visible con copy honesto
    expect(getByText("¡Transportista elegido!")).toBeTruthy();
    expect(
      getByText(/Tu envío quedó en espera de la confirmación del pago para iniciar el viaje/)
    ).toBeTruthy();

    // 5. Cerrar modal de éxito
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-success-modal-dismiss-btn"));
    });
    expect(router.back).toHaveBeenCalled();
  });

  it("maneja error 409 por asignación concurrente mostrando mensaje y refetcheando", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    const conflictError = new ApiError(409, "SHIPMENT_NOT_AVAILABLE_FOR_ASSIGNMENT", "Already assigned");
    mockMutateAccept.mockRejectedValueOnce(conflictError);

    const { getByTestId, getByText } = await render(<ShipmentOffersScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-accept-btn"));
    });

    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-modal-confirm-btn"));
    });

    expect(
      getByText("Esta oferta ya no está disponible o el envío fue asignado a otro transportista.")
    ).toBeTruthy();
    expect(mockRefetchOffers).toHaveBeenCalled();
    expect(mockRefetchShipment).toHaveBeenCalled();
  });

  it("flujo de rechazar una oferta puntual", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    mockMutateReject.mockResolvedValueOnce({
      ...sampleOffer1,
      status: OfferStatus.REJECTED,
    });

    const { getByTestId, getByText } = await render(<ShipmentOffersScreen />);

    // 1. Presionar "Rechazar"
    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-reject-btn"));
    });

    // 2. Modal de rechazo abierto
    expect(getByText("¿Rechazar esta oferta?")).toBeTruthy();

    // 3. Confirmar rechazo
    await act(async () => {
      fireEvent.press(getByTestId("reject-offer-modal-confirm-btn"));
    });

    expect(mockMutateReject).toHaveBeenCalledWith("off-1");
    expect(mockRefetchOffers).toHaveBeenCalled();
  });
});
