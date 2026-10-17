import { ApiError } from "@movo/shared/dist/errors/api-error";
import { act, fireEvent, render } from "@testing-library/react-native";
import { BalancePaySheet } from "../components/payments/balance-pay-sheet";

let mockPayData: any;
jest.mock("../src/hooks/use-balance", () => ({
  useBalancePayData: () => mockPayData,
  useRefreshBalance: () => jest.fn(),
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const card = {
  id: "card-1", mpCardId: "mp-1", brand: "visa", paymentMethodId: "visa", lastFourDigits: "3704",
  expirationMonth: 11, expirationYear: 2030, holderName: "APRO", issuerName: null, alias: null, isDefault: true,
  createdAt: "2026-10-01T00:00:00.000Z",
} as any;

describe("BalancePaySheet (MOVO-315)", () => {
  beforeEach(() => {
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
});
