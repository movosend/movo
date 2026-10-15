import { act, fireEvent, render } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { router, useLocalSearchParams } from "expo-router";
import PayShipmentScreen from "../app/(app)/shipments/[id]/pay";
import { type PayShipmentOutcome, tokenizeSavedCard } from "../src/lib/pay-shipment-flow";

const mockMutate = jest.fn();
let mockOnSettled: ((outcome: PayShipmentOutcome) => void) | undefined;
let mockPending = false;
const mockFunding = jest.fn();
const mockCards = jest.fn();
const mockShipment = jest.fn();
const mockRefetchCards = jest.fn();

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), replace: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

jest.mock("../src/hooks/use-shipment-funding", () => ({
  useShipmentFunding: () => mockFunding(),
  usePayShipment: (opts?: { onSettled?: (o: PayShipmentOutcome) => void }) => {
    mockOnSettled = opts?.onSettled;
    return { mutate: mockMutate, isPending: mockPending };
  },
}));
jest.mock("../src/lib/pay-shipment-flow", () => ({ tokenizeSavedCard: jest.fn() }));
jest.mock("../src/hooks/use-saved-cards", () => ({ useSavedCards: () => mockCards() }));
jest.mock("../src/hooks/use-shipments", () => ({ useShipment: () => mockShipment() }));
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => ({ data: { fullName: "Julieta Pérez" } }),
}));
// El alta (wizard de MOVO-101) tiene sus propios tests; acá solo interesa cómo la usa la pantalla.
jest.mock("../components/payments/pay-add-card-modal", () => {
  const { Pressable, View } = require("react-native");
  return {
    PayAddCardModal: ({ visible, onSaved }: { visible: boolean; onSaved: (c: unknown) => void }) =>
      visible ? (
        <View testID="add-card-sheet-mock">
          <Pressable testID="add-card-sheet-save" onPress={() => onSaved(mockNewCard)} />
        </View>
      ) : null,
  };
});

const baseCard = (over: Partial<SavedCard>): SavedCard => ({
  id: "c1",
  mpCardId: "mp-c1",
  alias: "Personal",
  brand: "visa",
  last4: "3704",
  expMonth: 11,
  expYear: 2099,
  issuerName: null,
  paymentType: null,
  isDefault: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const VISA = baseCard({});
const MASTER = baseCard({ id: "c2", mpCardId: "mp-c2", alias: null, brand: "master", last4: "8812", isDefault: false });
const AMEX = baseCard({ id: "c3", mpCardId: "mp-c3", alias: null, brand: "amex", last4: "1005", isDefault: false });
const EXPIRED = baseCard({ id: "c4", mpCardId: "mp-c4", alias: null, last4: "0001", isDefault: false, expYear: 2020 });
const mockNewCard = baseCard({ id: "c5", mpCardId: "mp-c5", alias: null, brand: "master", last4: "5555", isDefault: false });

const FUNDING = {
  shipmentId: "ship-1",
  route: "near",
  carrierPublicKey: "TEST-carrier-pk",
  amountArs: 18400,
  payUntil: new Date(Date.now() + 23 * 3600_000 + 60_000).toISOString(),
};

function setup(opts: { cards?: SavedCard[]; resumed?: boolean } = {}) {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: "ship-1", ...(opts.resumed ? { resumed: "1" } : {}) });
  mockFunding.mockReturnValue({ data: FUNDING, isLoading: false, isError: false, error: null, refetch: jest.fn() });
  mockCards.mockReturnValue({
    data: opts.cards ?? [VISA, MASTER],
    isLoading: false,
    isError: false,
    refetch: mockRefetchCards,
  });
  mockShipment.mockReturnValue({ data: { id: "ship-1", status: ShipmentStatus.ASSIGNMENT_PENDING, carrierId: "carrier-1" } });
}

describe("PayShipmentScreen (MOVO-269)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (tokenizeSavedCard as jest.Mock).mockResolvedValue({ kind: "token", cardToken: "tok-1" });
    mockPending = false;
    mockOnSettled = undefined;
  });

  it("preselecciona la predeterminada, muestra el monto y pide solo el CVV (AC2)", async () => {
    setup();
    const { getByTestId, queryByTestId, getAllByText } = await render(<PayShipmentScreen />);
    expect(getByTestId("pay-amount").props.children).toBe("$18.400");
    expect(getByTestId("pay-time-left").props.children).toMatch(/^Quedan 2[23] h$/);
    // Solo la tarjeta elegida muestra el campo del código; el resto, no.
    expect(getByTestId("pay-cvv")).toBeTruthy();
    expect(queryByTestId("pay-card-c2")).toBeTruthy();
    expect(getAllByText(/Personal/).length).toBeGreaterThan(0);
    // Con nombre de referencia, los últimos 4 se ven igual.
    expect(getAllByText(/•••• 3704/).length).toBeGreaterThan(0);
    expect(getByTestId("pay-cvv").props.secureTextEntry).toBe(true);
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(true);
  });

  it("el botón se habilita con 3 dígitos y reserva con la tarjeta y el CVV, sin tocar el backend directo (AC3)", async () => {
    setup();
    const { getByTestId } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "12"));
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(true);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(false);

    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(tokenizeSavedCard).toHaveBeenCalledWith({ funding: FUNDING, card: VISA, cvv: "123" });
    // React Query retiene las variables de la mutación: acá no puede viajar el CVV.
    expect(mockMutate).toHaveBeenCalledWith({ shipmentId: "ship-1", cardToken: "tok-1", savedCardId: VISA.id });
    expect(JSON.stringify(mockMutate.mock.calls[0][0])).not.toContain("123");
  });

  it("American Express pide 4 dígitos (AC2)", async () => {
    setup({ cards: [AMEX, VISA] });
    const { getByTestId } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.press(getByTestId("pay-card-select-c3")));
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(true);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "1234"));
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(false);
  });

  it("el doble tap no crea dos reservas: queda en curso y deshabilitado (AC6)", async () => {
    setup();
    const { getByTestId } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(getByTestId("pay-submit").props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    expect(getByTestId("pay-submit").props.accessibilityLabel).toBe("Reservando…");
  });

  it("al reservar muestra 'Fondos reservados' con copy de reserva, no de cobro (AC8)", async () => {
    setup();
    const { getByTestId, getByText, queryByTestId } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    await act(async () => mockOnSettled?.({ kind: "reserved" }));

    expect(getByText("Fondos reservados")).toBeTruthy();
    expect(getByText(/No se cobró nada: el cobro se hace recién cuando Julieta entregue el paquete/)).toBeTruthy();
    expect(getByText("Al entregar el paquete")).toBeTruthy();
    expect(queryByTestId("pay-cvv")).toBeNull();

    await act(async () => fireEvent.press(getByTestId("pay-done-cta")));
    expect(router.dismissTo).toHaveBeenCalledWith("/(app)/shipments/ship-1");
  });

  it("fondos insuficientes: motivo diferenciado, limpia el CVV y permite reintentar u otra tarjeta (AC4)", async () => {
    setup();
    const { getByTestId, getByText } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    await act(async () =>
      mockOnSettled?.({ kind: "rejected", reason: "insufficient_funds", payUntil: FUNDING.payUntil }),
    );

    expect(getByText("Tu tarjeta no tiene fondos suficientes")).toBeTruthy();
    expect(getByTestId("pay-cvv").props.value).toBe("");
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(true);
    // Elegir otra tarjeta sigue disponible.
    await act(async () => fireEvent.press(getByTestId("pay-card-select-c2")));
    expect(getByTestId("pay-card-c2")).toBeTruthy();
  });

  it("CVV incorrecto: 'Revisá el código de seguridad' y el campo en error (AC4)", async () => {
    setup();
    const { getByTestId, getAllByText } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "132"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    await act(async () => mockOnSettled?.({ kind: "rejected", reason: "invalid_data", payUntil: null }));

    expect(getAllByText("Revisá el código de seguridad").length).toBeGreaterThan(0);
    expect(getByTestId("pay-cvv-hint").props.children).toBe("El código no coincide con la tarjeta. No se cobró nada.");
    // Al volver a escribir, el error se va.
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "1"));
    expect(getByTestId("pay-cvv-hint").props.children).toBe("Los 3 dígitos del dorso de la tarjeta.");
  });

  it("tarjeta rechazada y error de plataforma tienen su propio copy (AC4)", async () => {
    setup();
    const { getByTestId, getByText } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    await act(async () => mockOnSettled?.({ kind: "rejected", reason: "card_rejected", payUntil: null }));
    expect(getByText("Tu banco rechazó la tarjeta")).toBeTruthy();

    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    await act(async () => mockOnSettled?.({ kind: "rejected", reason: "platform_error", payUntil: null }));
    expect(getByText("No pudimos reservar los fondos")).toBeTruthy();
  });

  it("cambiar de tarjeta limpia el CVV", async () => {
    setup();
    const { getByTestId } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-card-select-c2")));
    expect(getByTestId("pay-cvv").props.value).toBe("");
  });

  it("una tarjeta vencida no se puede elegir", async () => {
    setup({ cards: [VISA, EXPIRED] });
    const { getByTestId } = await render(<PayShipmentScreen />);
    expect(getByTestId("pay-card-select-c4").props.accessibilityState.disabled).toBe(true);
  });

  it("sin tarjetas guardadas ofrece agregar tarjeta y no deja reservar (AC5)", async () => {
    setup({ cards: [] });
    const { getByTestId } = await render(<PayShipmentScreen />);
    expect(getByTestId("pay-empty")).toBeTruthy();
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(true);
    await act(async () => fireEvent.press(getByTestId("pay-empty-add")));
    expect(getByTestId("add-card-sheet-mock")).toBeTruthy();
  });

  it("al guardar una tarjeta nueva vuelve con ella elegida pidiendo el CVV de nuevo (AC5)", async () => {
    // La hoja agrega la tarjeta a la cache de tarjetas antes de avisar: ya viene en la lista.
    setup({ cards: [VISA, mockNewCard] });
    const { getByTestId, queryByTestId } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-add-card")));
    await act(async () => fireEvent.press(getByTestId("add-card-sheet-save")));
    expect(queryByTestId("add-card-sheet-mock")).toBeNull();
    expect(getByTestId("pay-card-c5")).toBeTruthy();
    expect(getByTestId("pay-cvv").props.value).toBe("");
    // El copy aclara por qué se vuelve a pedir el código.
    expect(getByTestId("pay-just-added")).toBeTruthy();
    expect(getByTestId("pay-submit").props.accessibilityState.disabled).toBe(true);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    expect(mockMutate).toHaveBeenCalledWith({ shipmentId: "ship-1", cardToken: "tok-1", savedCardId: mockNewCard.id });
  });

  it("un error ambiguo del backend vuelve a pedir los datos del pago (HOLD_CONFLICT, 5xx)", async () => {
    const refetch = jest.fn();
    mockFunding.mockReturnValue({ data: FUNDING, isLoading: false, isError: false, error: null, refetch });
    const { findByTestId } = await render(<PayShipmentScreen />);
    await act(async () =>
      mockOnSettled?.({ kind: "error", error: new ApiError(409, "HOLD_CONFLICT", "conflicto") }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(await findByTestId("pay-submit")).toBeTruthy();
  });

  it("un error de validación (422) no refresca nada", async () => {
    const refetch = jest.fn();
    mockFunding.mockReturnValue({ data: FUNDING, isLoading: false, isError: false, error: null, refetch });
    await render(<PayShipmentScreen />);
    await act(async () => mockOnSettled?.({ kind: "error", error: new ApiError(422, "VALIDATION_ERROR", "x") }));
    expect(refetch).not.toHaveBeenCalled();
  });

  it("al retomar un pago a medias avisa que hay que volver a escribir el código (AC7)", async () => {
    setup({ resumed: true });
    const { getByTestId, getByText } = await render(<PayShipmentScreen />);
    expect(getByTestId("pay-resumed")).toBeTruthy();
    expect(getByText(/volvé a escribir el código de seguridad/)).toBeTruthy();
  });

  it("si venció el plazo, el envío volvió a publicarse y no se retuvo nada (AC7)", async () => {
    setup();
    mockFunding.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(409, "SHIPMENT_FUNDING_NOT_AVAILABLE", "vencido"),
      refetch: jest.fn(),
    });
    mockShipment.mockReturnValue({ data: { id: "ship-1", status: ShipmentStatus.PUBLISHED, carrierId: null } });
    const { getByTestId, getByText } = await render(<PayShipmentScreen />);
    expect(getByTestId("pay-unavailable")).toBeTruthy();
    expect(getByText("El envío volvió a publicarse")).toBeTruthy();
    expect(getByText("No retuvimos ni cobramos nada en tu tarjeta.")).toBeTruthy();
  });

  it("un 409 al pagar (venció mientras tanto) también lleva a la pantalla de vencido", async () => {
    setup();
    mockShipment.mockReturnValue({ data: { id: "ship-1", status: ShipmentStatus.PUBLISHED, carrierId: null } });
    const { getByTestId } = await render(<PayShipmentScreen />);
    await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
    await act(async () => fireEvent.press(getByTestId("pay-submit")));
    await act(async () =>
      mockOnSettled?.({ kind: "unavailable", error: new ApiError(409, "SHIPMENT_FUNDING_NOT_AVAILABLE", "x") }),
    );
    expect(getByTestId("pay-unavailable")).toBeTruthy();
  });

  it("un error de red al cargar ofrece reintentar", async () => {
    setup();
    mockFunding.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "caído"),
      refetch: jest.fn(),
    });
    const { getByTestId } = await render(<PayShipmentScreen />);
    expect(getByTestId("pay-load-error")).toBeTruthy();
    expect(getByTestId("pay-retry")).toBeTruthy();
  });

  describe("modo demo de los atajos de desarrollo", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("usa tarjetas de prueba y resuelve según el CVV sin llamar al backend", async () => {
      setup();
      (useLocalSearchParams as jest.Mock).mockReturnValue({ id: "demo-id", demo: "form" });
      const { getByTestId, getByText } = await render(<PayShipmentScreen />);
      expect(getByTestId("pay-card-demo-visa")).toBeTruthy();
      expect(getByTestId("pay-amount").props.children).toBe("$18.400");

      await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "132"));
      await act(async () => fireEvent.press(getByTestId("pay-submit")));
      await act(async () => {
        jest.advanceTimersByTime(1600);
      });
      expect(mockMutate).not.toHaveBeenCalled();
      expect(getByTestId("pay-failure")).toBeTruthy();

      await act(async () => fireEvent.changeText(getByTestId("pay-cvv"), "123"));
      await act(async () => fireEvent.press(getByTestId("pay-submit")));
      await act(async () => {
        jest.advanceTimersByTime(1600);
      });
      expect(getByText("Fondos reservados")).toBeTruthy();
    });
  });
});
