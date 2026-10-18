import { ApiError } from "@movo/shared/dist/errors/api-error";
import { act, fireEvent, render } from "@testing-library/react-native";
import { BalancePaySheet } from "../components/payments/balance-pay-sheet";

let mockPayData: any;
const mockRefresh = jest.fn();
const mockPay = jest.fn();
jest.mock("../src/hooks/use-balance", () => ({
  useBalancePayData: () => mockPayData,
  useRefreshBalance: () => mockRefresh,
}));
jest.mock("../src/lib/pay-balance-flow", () => ({
  ...jest.requireActual("../src/lib/pay-balance-flow"),
  payBalanceWithSavedCard: (...args: unknown[]) => mockPay(...args),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const card = {
  id: "card-1", mpCardId: "mp-1", brand: "visa", paymentMethodId: "visa", lastFourDigits: "3704",
  expirationMonth: 11, expirationYear: 2030, holderName: "APRO", issuerName: null, alias: null, isDefault: true,
  createdAt: "2026-10-01T00:00:00.000Z",
} as any;

describe("BalancePaySheet (MOVO-315)", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    mockPay.mockReset();
    mockPayData = { data: { publicKey: "TEST-key", balanceArs: 5000 }, isError: false, isFetching: false, error: null, refetch: jest.fn() };
  });

  it("deja el botón de pagar fuera del scroll y lo habilita con CVV", async () => {
    const screen = await render(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />);
    expect(screen.getByText("Pagar $5.000")).toBeTruthy();
    await act(async () => { fireEvent.changeText(screen.getByTestId("pay-cvv"), "123"); });
    expect(screen.getByTestId("balance-pay-submit").props.accessibilityState.disabled).toBe(false);
  });

  it("'Otro monto' agrupa miles y valida contra el saldo", async () => {
    const screen = await render(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />);
    await act(async () => { fireEvent.press(screen.getByTestId("balance-amount-partial")); });
    await act(async () => { fireEvent.changeText(screen.getByTestId("balance-partial-amount"), "2500"); });
    expect(screen.getByTestId("balance-partial-amount").props.value).toBe("2.500");
    expect(screen.getByText("Te van a quedar $2.500 pendientes.")).toBeTruthy();
    expect(screen.getByText("Pagar $2.500")).toBeTruthy();
    await act(async () => { fireEvent.changeText(screen.getByTestId("balance-partial-amount"), "6000"); });
    expect(screen.getByText("Ingresá un monto de hasta $5.000.")).toBeTruthy();
  });

  it("si no se pueden traer los datos de pago, reemplaza el formulario por el error", async () => {
    mockPayData = { data: undefined, isError: true, isFetching: false, error: new ApiError(503, "BALANCE_COLLECTOR_NOT_CONFIGURED", "x"), refetch: jest.fn() };
    const screen = await render(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />);
    expect(screen.getByText("Por ahora no podés pagar el saldo con tarjeta")).toBeTruthy();
    expect(screen.queryByTestId("balance-pay-submit")).toBeNull();
    // Reintentar no lo arregla: solo se ofrece cerrar.
    expect(screen.queryByTestId("balance-pay-data-retry")).toBeNull();
    expect(screen.getByText("Entendido")).toBeTruthy();
  });

  it("ante un error de red ofrece reintentar", async () => {
    mockPayData = { data: undefined, isError: true, isFetching: false, error: new Error("network"), refetch: jest.fn() };
    const screen = await render(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />);
    expect(screen.getByText("No pudimos preparar el pago")).toBeTruthy();
    fireEvent.press(screen.getByTestId("balance-pay-data-retry"));
    expect(mockPayData.refetch).toHaveBeenCalled();
  });

  it("no muestra el formulario mientras prepara el pago", async () => {
    mockPayData = { data: undefined, isError: false, isFetching: true, error: null, refetch: jest.fn() };
    const screen = await render(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />);
    expect(screen.getByTestId("balance-pay-loading")).toBeTruthy();
    expect(screen.queryByTestId("balance-pay-submit")).toBeNull();
  });

  describe("pago pendiente en Mercado Pago", () => {
    const toPending = async () => {
      mockPay.mockResolvedValue({ status: "pending", balanceArs: 5000 });
      const screen = await render(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />);
      await act(async () => { fireEvent.changeText(screen.getByTestId("pay-cvv"), "123"); });
      await act(async () => { fireEvent.press(screen.getByTestId("balance-pay-submit")); });
      expect(screen.getByText("Estamos confirmando tu pago")).toBeTruthy();
      mockRefresh.mockClear();
      return screen;
    };

    it("pasa a aprobado cuando el saldo baja y conserva lo que se pagó", async () => {
      const screen = await toPending();
      mockPayData = { ...mockPayData, data: { publicKey: "TEST-key", balanceArs: 2000 } };
      await act(async () => { screen.rerender(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />); });
      // En modo total `amount` pasa a ser el saldo restante: lo pagado sigue siendo el monto original.
      expect(screen.getByText("Pagaste $5.000")).toBeTruthy();
      expect(screen.getByText("Te quedan $2.000 pendientes.")).toBeTruthy();
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("pasa a aprobado sin saldo si pay-data responde 422 por deuda en cero, aunque quede el último dato en caché", async () => {
      const screen = await toPending();
      mockPayData = { ...mockPayData, isError: true, error: new ApiError(422, "BALANCE_AMOUNT_EXCEEDS_DEBT", "x") };
      await act(async () => { screen.rerender(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />); });
      expect(screen.getByText("Pagaste $5.000")).toBeTruthy();
      expect(screen.getByText("Ya no tenés saldo pendiente.")).toBeTruthy();
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("sigue pendiente mientras el saldo no cambie", async () => {
      const screen = await toPending();
      await act(async () => { screen.rerender(<BalancePaySheet visible onClose={jest.fn()} cards={[card]} initialBalanceArs={5000} />); });
      expect(screen.getByText("Estamos confirmando tu pago")).toBeTruthy();
    });
  });
});
