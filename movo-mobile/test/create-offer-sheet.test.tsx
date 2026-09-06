import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { CreateOfferSheet } from "../components/transport/create-offer-sheet";
import type { ShipmentSummary } from "../src/api/shipments-client";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}));

const mockMutateAsync = jest.fn();
let mockIsPending = false;

jest.mock("../src/hooks/use-offers", () => ({
  useCreateOffer: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
  }),
}));

function mockShipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "shipment-123",
    senderId: "user-sender",
    receiverId: "user-receiver",
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
    pickupDate: "2026-09-10",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 8500,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.PUBLISHED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("CreateOfferSheet (MOVO-149)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPending = false;
  });

  it("abre la hoja con el precio sugerido prellenado y la fecha de retiro", async () => {
    const shipment = mockShipment({ suggestedPriceArs: 9200, pickupDate: "2026-09-10" });
    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    const priceInput = getByTestId("sheet-price-input");
    expect(priceInput.props.value).toBe("9200");

    const dateInput = getByTestId("sheet-date-input");
    expect(dateInput.props.value).toContain("2026-09-10");
  });

  it("permite editar el monto neto y enviar la oferta exitosamente", async () => {
    const shipment = mockShipment({ suggestedPriceArs: 5000 });
    mockMutateAsync.mockResolvedValueOnce({
      id: "offer-1",
      shipmentId: shipment.id,
      carrierId: "carrier-1",
      priceNetArs: 6000,
      commissionAmountArs: 900,
      priceOffered: 6900,
      offeredDate: "2026-09-10",
      message: "Salgo al mediodía.",
      carrierRatingAtOffer: null,
      carrierNameAtOffer: "Juan",
      status: "pending",
      expiresAt: null,
      createdAt: "2026-08-20T10:00:00.000Z",
      respondedAt: null,
    });

    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    const priceInput = getByTestId("sheet-price-input");
    await act(async () => {
      fireEvent.changeText(priceInput, "6000");
    });

    const messageInput = getByTestId("sheet-message-input");
    await act(async () => {
      fireEvent.changeText(messageInput, "Salgo al mediodía.");
    });

    const submitBtn = getByTestId("sheet-submit");
    await act(async () => {
      fireEvent.press(submitBtn);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      priceOfferedArs: 6000,
      offeredDate: "2026-09-10",
      message: "Salgo al mediodía.",
    });
  });

  it("al responder con éxito el servidor, muestra el desglose exacto (neto, comisión, bruto)", async () => {
    const shipment = mockShipment({ suggestedPriceArs: 5000 });
    mockMutateAsync.mockResolvedValueOnce({
      id: "offer-1",
      shipmentId: shipment.id,
      carrierId: "carrier-1",
      priceNetArs: 5000,
      commissionAmountArs: 750,
      priceOffered: 5750,
      offeredDate: "2026-09-10",
      message: null,
      carrierRatingAtOffer: null,
      carrierNameAtOffer: "Juan",
      status: "pending",
      expiresAt: null,
      createdAt: "2026-08-20T10:00:00.000Z",
      respondedAt: null,
    });

    const mockOnSuccess = jest.fn();
    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        onSuccess={mockOnSuccess}
        testID="sheet"
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("sheet-submit"));
    });

    await waitFor(() => {
      expect(getByTestId("sheet-breakdown")).toBeTruthy();
    });

    expect(getByTestId("sheet-net-price")).toHaveTextContent("$5.000");
    expect(getByTestId("sheet-commission-price")).toHaveTextContent("$750");
    expect(getByTestId("sheet-gross-price")).toHaveTextContent("$5.750");

    await act(async () => {
      fireEvent.press(getByTestId("sheet-success-cta"));
    });

    expect(mockOnSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "offer-1",
        priceNetArs: 5000,
        priceOffered: 5750,
      })
    );
  });

  it("error 409: envío ya no disponible mapea a mensaje claro", async () => {
    const shipment = mockShipment();
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError(409, "SHIPMENT_NOT_AVAILABLE_FOR_OFFER", "Not available")
    );

    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("sheet-submit"));
    });

    await waitFor(() => {
      expect(getByTestId("sheet-error")).toBeTruthy();
    });

    const errorBanner = getByTestId("sheet-error");
    expect(errorBanner).toHaveTextContent("Este envío ya no está disponible para ofertar.");
  });

  it("error 409: oferta duplicada mapea a mensaje claro", async () => {
    const shipment = mockShipment();
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError(409, "OFFER_DUPLICATE_ACTIVE", "Duplicate offer")
    );

    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("sheet-submit"));
    });

    await waitFor(() => {
      expect(getByTestId("sheet-error")).toBeTruthy();
    });

    const errorBanner = getByTestId("sheet-error");
    expect(errorBanner).toHaveTextContent("Ya tenés una oferta activa sobre este envío.");
  });

  it("error 422: fecha inválida fuera de rango mapea a mensaje claro", async () => {
    const shipment = mockShipment();
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError(422, "OFFER_DATE_OUT_OF_RANGE", "Date out of range")
    );

    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("sheet-submit"));
    });

    await waitFor(() => {
      expect(getByTestId("sheet-error")).toBeTruthy();
    });

    const errorBanner = getByTestId("sheet-error");
    expect(errorBanner).toHaveTextContent("La fecha del viaje tiene que coincidir con la fecha de retiro del envío.");
  });

  it("error 403: falta KYC muestra acción directa al flujo de KYC", async () => {
    const shipment = mockShipment();
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError(403, "CARRIER_NOT_VERIFIED", "Carrier not verified")
    );

    const mockOnClose = jest.fn();
    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={mockOnClose}
        testID="sheet"
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("sheet-submit"));
    });

    await waitFor(() => {
      expect(getByTestId("sheet-kyc-error")).toBeTruthy();
    });

    const kycCta = getByTestId("sheet-kyc-cta");
    await act(async () => {
      fireEvent.press(kycCta);
    });

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/kyc");
  });

  it("monto inválido con múltiples comas muestra error, icono X y deshabilita el botón", async () => {
    const shipment = mockShipment({ suggestedPriceArs: 5000 });
    const { getByTestId, queryByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    const priceInput = getByTestId("sheet-price-input");
    await act(async () => {
      fireEvent.changeText(priceInput, "50,,00");
    });

    const errorText = getByTestId("sheet-price-input-error");
    expect(errorText).toHaveTextContent("Ingresá un monto válido");

    const errorIcon = getByTestId("sheet-price-error-icon");
    expect(errorIcon).toBeTruthy();

    const submitBtn = getByTestId("sheet-submit");
    expect(submitBtn.props.accessibilityState?.disabled).toBe(true);
  });

  it("limita el ingreso de decimales a como máximo dos dígitos", async () => {
    const shipment = mockShipment({ suggestedPriceArs: 5000 });
    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    const priceInput = getByTestId("sheet-price-input");

    // Al escribir un tercer decimal, se trunca a 2 decimales
    await act(async () => {
      fireEvent.changeText(priceInput, "5000,123");
    });

    expect(priceInput.props.value).toBe("5000,12");
  });

  it("permite enviar un monto con coma decimal normalizándolo a número", async () => {
    const shipment = mockShipment({ suggestedPriceArs: 5000 });
    mockMutateAsync.mockResolvedValueOnce({
      id: "offer-dec",
      shipmentId: shipment.id,
      carrierId: "carrier-1",
      priceNetArs: 5500.5,
      commissionAmountArs: 825.07,
      priceOffered: 6325.57,
      offeredDate: "2026-09-10",
      message: null,
      carrierRatingAtOffer: null,
      carrierNameAtOffer: "Juan",
      status: "pending",
      expiresAt: null,
      createdAt: "2026-08-20T10:00:00.000Z",
      respondedAt: null,
    });

    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    const priceInput = getByTestId("sheet-price-input");
    await act(async () => {
      fireEvent.changeText(priceInput, "5500,50");
    });

    const submitBtn = getByTestId("sheet-submit");
    await act(async () => {
      fireEvent.press(submitBtn);
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      priceOfferedArs: 5500.5,
      offeredDate: "2026-09-10",
      message: undefined,
    });
  });

  it("monto 0 muestra error de monto válido", async () => {
    const shipment = mockShipment({ suggestedPriceArs: 5000 });
    const { getByTestId } = await render(
      <CreateOfferSheet
        visible={true}
        shipment={shipment}
        onClose={jest.fn()}
        testID="sheet"
      />
    );

    const priceInput = getByTestId("sheet-price-input");
    await act(async () => {
      fireEvent.changeText(priceInput, "0");
    });

    const errorText = getByTestId("sheet-price-input-error");
    expect(errorText).toHaveTextContent("Ingresá un monto válido");

    const submitBtn = getByTestId("sheet-submit");
    expect(submitBtn.props.accessibilityState?.disabled).toBe(true);
  });
});

