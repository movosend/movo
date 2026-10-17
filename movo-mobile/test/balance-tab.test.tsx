import { fireEvent, render } from "@testing-library/react-native";
import { BalanceTab } from "../components/payments/balance-tab";

const mockFetchNextPage = jest.fn();
const mockRefetch = jest.fn();
let mockPage: any;
let mockHasNextPage = false;

jest.mock("../src/hooks/use-balance", () => ({
  useBalance: () => ({ data: { pages: [mockPage] }, isPending: false, isError: false, isRefetching: false, isFetchingNextPage: false, hasNextPage: mockHasNextPage, fetchNextPage: mockFetchNextPage, refetch: mockRefetch }),
}));
jest.mock("../src/hooks/use-saved-cards", () => ({ useSavedCards: () => ({ data: [] }) }));
jest.mock("../components/payments/balance-pay-sheet", () => ({ BalancePaySheet: () => null }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

const movement = {
  id: "entry-1", userId: "user-1", roleAtOrigin: "carrier", type: "cancellation_penalty", amountArs: 2400,
  status: "pending", shipmentId: "12345678-1234-1234-1234-123456789abc", holdId: null, paymentId: null,
  reason: null, originLabel: "Envío a Rosario #12345678", createdAt: "2026-10-14T12:00:00.000Z",
};

describe("BalanceTab (MOVO-315)", () => {
  beforeEach(() => { jest.clearAllMocks(); mockHasNextPage = false; mockPage = { balanceArs: 6100, oldestUnpaidAt: "2026-09-20T12:00:00.000Z", items: [movement], nextCursor: null }; });

  it("muestra deuda, rol, origen y acceso al envío", async () => {
    const screen = await render(<BalanceTab />);
    expect(screen.getByText("$6.100")).toBeTruthy();
    expect(screen.getByText("Penalidad")).toBeTruthy();
    expect(screen.getByText("Envío a Rosario #12345678 ›")).toBeTruthy();
    fireEvent.press(screen.getByText("Envío a Rosario #12345678 ›"));
    expect(mockPush).toHaveBeenCalledWith("/shipments/12345678-1234-1234-1234-123456789abc");
  });

  it("permite cargar más movimientos por cursor", async () => {
    mockHasNextPage = true;
    const screen = await render(<BalanceTab />);
    fireEvent.press(screen.getByText("Cargar más"));
    expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("muestra saldo a favor sin CTA de pago y marca anulados", async () => {
    mockPage = { ...mockPage, balanceArs: -100, items: [{ ...movement, status: "voided" }] };
    const screen = await render(<BalanceTab />);
    expect(screen.getByText("Tenés saldo a favor")).toBeTruthy();
    expect(screen.queryByText("Pagar mi saldo")).toBeNull();
    expect(screen.getByText("Penalidad · Anulado")).toBeTruthy();
  });

  it("no inventa un rol para un pago voluntario", async () => {
    mockPage = { ...mockPage, items: [{ ...movement, roleAtOrigin: null, type: "voluntary_payment", amountArs: -1500, shipmentId: null, originLabel: null }] };
    const screen = await render(<BalanceTab />);
    expect(screen.getByText("Pago de saldo")).toBeTruthy();
    expect(screen.queryByText(/Como emisor/)).toBeNull();
    expect(screen.queryByText(/Como transportista/)).toBeNull();
  });
});
