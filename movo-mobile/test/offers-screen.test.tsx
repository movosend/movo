import { act, fireEvent, render } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { OfferStatus } from "@movo/shared/dist/types/offer";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import ShipmentOffersScreen from "../app/(app)/shipments/[id]/offers";
import type { OfferSummary } from "../src/api/offers-client";

const mockUseShipmentOffers = jest.fn();
const mockMutateAccept = jest.fn();
const mockMutateReject = jest.fn();
const mockRefetchOffers = jest.fn();
const mockRefetchShipment = jest.fn();
const mockUseShipment = jest.fn(() => ({
  data: undefined as any,
  refetch: mockRefetchShipment,
}));
const mockUsePublicProfile = jest.fn();
// Retiro ya dentro de la ventana de pago (fecha pasada): el pago se reserva al elegir.
const PICKUP_FIELDS = {
  pickupDate: "2020-01-01",
  pickupTimeWindowStart: "09:00:00",
  pickupTimeWindowEnd: "12:00:00",
};

// MOVO-300: sin suspensión; el caso suspendido tiene sus propios tests.
jest.mock("../src/hooks/use-account-restriction", () => ({
  useActiveSuspension: () => null,
  useAccountRestrictionSync: () => {},
}));

jest.mock("expo-router", () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    push: jest.fn(),
    replace: jest.fn(),
    dismissTo: jest.fn(),
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
  useShipment: () => mockUseShipment(),
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
    priceNetArs: 10200,
    commissionAmountArs: 1800,
    senderNameAtOffer: null,
    senderVerifiedAtOffer: null,
    senderRatingAtOffer: null,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    viewedAtBySender: null,
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
    priceNetArs: 8500,
    commissionAmountArs: 1500,
    senderNameAtOffer: null,
    senderVerifiedAtOffer: null,
    senderRatingAtOffer: null,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    viewedAtBySender: null,
    status: OfferStatus.PENDING,
    expiresAt: null,
    createdAt: "2026-08-25T11:00:00.000Z",
    respondedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: "ship-1" });
    mockUseShipment.mockReturnValue({
      data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: null, status: ShipmentStatus.PUBLISHED },
      refetch: mockRefetchShipment,
    });
    mockUsePublicProfile.mockReturnValue({
      data: {
        id: "carr-1",
        fullName: "Lucas Transportista",
        photoUrl: null,
        isVerified: true,
        badges: ["kyc_verified"],
        transactionCounts: { asSender: 0, asCarrier: 15 },
        reputationScore: 4.9,
        ratingCount: 15,
        isNewProfile: false,
        asSender: { reputationScore: null, ratingCount: 0, isNewProfile: true },
        asCarrier: { reputationScore: 4.9, ratingCount: 15, isNewProfile: false },
        recentRatingComments: [],
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

  // MOVO-176: la sheet chica de MOVO-154 se reemplazó por una pantalla completa.
  it("navega a la pantalla de perfil del transportista al tocar su cabecera", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });

    const { getByTestId } = await render(<ShipmentOffersScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-carrier-pressable"));
    });

    expect(router.push).toHaveBeenCalledWith(`/profile/${sampleOffer1.carrierId}`);
  });

  // MOVO-211 AC4: los dos desenlaces de la aceptación se leen como éxito.
  async function acceptWithAssignment(assignment: unknown) {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    mockMutateAccept.mockResolvedValueOnce({ ...sampleOffer1, status: OfferStatus.ACCEPTED, assignment });
    const screen = await render(<ShipmentOffersScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId("offer-card-off-1-accept-btn"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("choose-offer-modal-confirm"));
    });
    return screen;
  }

  it("retiro cercano: el éxito lleva directo a reservar el pago con el monto (MOVO-211)", async () => {
    const { getByText, getByTestId, queryByTestId } = await acceptWithAssignment({
      shipmentStatus: "assignment_pending",
      fundingRoute: "near",
      fundingWindowOpensAt: null,
    });

    expect(getByText("Elegiste a Lucas")).toBeTruthy();
    expect(getByTestId("choose-offer-success-modal-near-amount")).toHaveTextContent(/\$12\.000/);
    expect(queryByTestId("choose-offer-success-modal-dismiss-btn")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-success-modal-pay-btn"));
    });
    expect(router.replace).toHaveBeenCalledWith("/shipments/ship-1/pay");
  });

  it("retiro lejano: confirma la asignación y explica que el pago se confirma más adelante (MOVO-211)", async () => {
    const { getByText, getByTestId, queryByTestId } = await acceptWithAssignment({
      shipmentStatus: "assigned_unfunded",
      fundingRoute: "far",
      fundingWindowOpensAt: "2026-10-06T12:00:00.000Z",
    });

    expect(getByText("Lucas lleva tu paquete")).toBeTruthy();
    expect(getByText(/Hoy no se retiene ni se cobra nada/)).toBeTruthy();
    expect(getByTestId("choose-offer-success-modal-far-timeline")).toBeTruthy();
    expect(queryByTestId("choose-offer-success-modal-pay-btn")).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-success-modal-dismiss-btn"));
    });
    expect(router.dismissTo).toHaveBeenCalledWith("/shipments/ship-1");
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
    expect(getByTestId("choose-offer-modal-payment-note")).toBeTruthy();
    expect(getByText(/Después te pedimos reservar el pago/)).toBeTruthy();

    // 3. Confirmar elección
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-modal-confirm"));
    });

    expect(mockMutateAccept).toHaveBeenCalledWith("off-1");

    // 4. Modal de éxito visible con copy animado "¡Oferta aceptada!"
    expect(getByText("¡Oferta aceptada!")).toBeTruthy();
    expect(getByText(/Ahora reservá el pago con tu tarjeta para confirmar el viaje/)).toBeTruthy();

    // 5. Cerrar modal de éxito
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-success-modal-dismiss-btn"));
    });
    expect(router.dismissTo).toHaveBeenCalledWith("/shipments/ship-1");
  });

  // MOVO-244 review (PR #184): antes, el efecto de redirect (guardado solo por
  // `isSuccessModalVisible`) y `handleSuccessDismiss` disparaban cada uno su propio
  // `router.replace` al mismo destino apenas `shipment.carrierId` llegaba por el
  // refetch — dos instancias apiladas del detalle. Acá el refetch de `useShipment` ya
  // resolvió con `carrierId` seteado ANTES del dismiss (el caso real que lo disparaba).
  it("no duplica la navegación si el refetch del envío ya trae carrierId antes de cerrar el modal de éxito", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    // Al montar, el envío todavía no tiene transportista (si ya lo tuviera, el
    // usuario ni siquiera debería poder llegar acá — ver el otro test de este
    // mismo `describe`). El mock se actualiza recién DENTRO de `mutateAsync`, para
    // simular que la invalidación de MOVO-150 ya resolvió con `carrierId` seteado
    // justo cuando se muestra el modal de éxito — el caso real que disparaba el bug.
    mockUseShipment.mockReturnValue({
      data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: null, status: ShipmentStatus.PUBLISHED },
      refetch: mockRefetchShipment,
    });
    mockMutateAccept.mockImplementationOnce(async () => {
      mockUseShipment.mockReturnValue({
        data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: "carr-1", status: ShipmentStatus.ASSIGNMENT_PENDING },
        refetch: mockRefetchShipment,
      });
      return { ...sampleOffer1, status: OfferStatus.ACCEPTED };
    });

    const { getByTestId, getByText } = await render(<ShipmentOffersScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-accept-btn"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-modal-confirm"));
    });

    expect(getByText("¡Oferta aceptada!")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-success-modal-dismiss-btn"));
    });

    // MOVO-269: con retiro cercano el envío queda `assignment_pending` y el emisor paga en el
    // mismo flujo. Una sola navegación (a la pantalla de pago), nunca también al detalle.
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/shipments/ship-1/pay");
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it("decide el destino con el estado que devuelve el refetch aunque el render siga viejo (MOVO-269)", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    // El `shipment` del render nunca se actualiza: sigue `published` al cerrar el modal.
    mockUseShipment.mockReturnValue({
      data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: null, status: ShipmentStatus.PUBLISHED },
      refetch: mockRefetchShipment,
    });
    mockRefetchShipment.mockResolvedValueOnce({
      data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: "carr-1", status: ShipmentStatus.ASSIGNMENT_PENDING },
    });
    mockMutateAccept.mockImplementationOnce(async () => ({ ...sampleOffer1, status: OfferStatus.ACCEPTED }));

    const { getByTestId } = await render(<ShipmentOffersScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-accept-btn"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-modal-confirm"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-success-modal-dismiss-btn"));
    });

    expect(router.replace).toHaveBeenCalledWith("/shipments/ship-1/pay");
  });

  it("con retiro lejano (assigned_unfunded) vuelve al detalle: el pago se confirma más adelante (MOVO-269)", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [sampleOffer1],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    mockUseShipment.mockReturnValue({
      data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: null, status: ShipmentStatus.PUBLISHED },
      refetch: mockRefetchShipment,
    });
    mockMutateAccept.mockImplementationOnce(async () => {
      mockUseShipment.mockReturnValue({
        data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: "carr-1", status: ShipmentStatus.ASSIGNED_UNFUNDED },
        refetch: mockRefetchShipment,
      });
      return { ...sampleOffer1, status: OfferStatus.ACCEPTED };
    });

    const { getByTestId } = await render(<ShipmentOffersScreen />);
    await act(async () => {
      fireEvent.press(getByTestId("offer-card-off-1-accept-btn"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-modal-confirm"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("choose-offer-success-modal-dismiss-btn"));
    });

    expect(router.dismissTo).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).toHaveBeenCalledWith("/shipments/ship-1");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("redirige al detalle del envío si el envío ya tiene transportista asignado", async () => {
    mockUseShipmentOffers.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetchOffers,
      isRefetching: false,
    });
    mockUseShipment.mockReturnValue({
      data: { ...PICKUP_FIELDS, id: "ship-1", carrierId: "carrier-123", status: ShipmentStatus.ASSIGNED },
      refetch: mockRefetchShipment,
    });

    await render(<ShipmentOffersScreen />);

    expect(router.dismissTo).toHaveBeenCalledWith("/shipments/ship-1");
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
      fireEvent.press(getByTestId("choose-offer-modal-confirm"));
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
