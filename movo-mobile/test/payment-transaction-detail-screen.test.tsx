import type { TransactionDetail } from "@movo/shared/dist/types/transaction";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import PaymentTransactionDetailScreen from "../app/(app)/profile/payments/history/[id]";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { id?: string; role?: string } = {};

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));

const mockUseTransaction = jest.fn();
jest.mock("../src/hooks/use-transactions", () => ({
  ...jest.requireActual("../src/hooks/use-transactions"),
  useTransaction: (...args: unknown[]) => mockUseTransaction(...args),
}));

const mockRefetch = jest.fn();

const SHIPMENT_ID = "00000000-0000-4000-8000-000000046380";

function detail(overrides: Partial<TransactionDetail> = {}): TransactionDetail {
  return {
    id: "tx-1",
    kind: "shipment",
    shipmentId: SHIPMENT_ID,
    date: "2026-10-04T17:32:00.000Z",
    amountArs: 5200,
    status: "refunded",
    refundedAmountArs: 1500,
    debtAmountArs: null,
    card: { brand: "master", last4: "1881" },
    capturedAt: "2026-10-06T12:00:00.000Z",
    releasedAt: null,
    releaseReason: null,
    movements: [{ kind: "refund", amountArs: 1500, date: "2026-10-08T13:00:00.000Z" }],
    ...overrides,
  };
}

const BREAKDOWN = { grossArs: 8900, mpFeeArs: 365, commissionArs: 1161, debtOffsetArs: 0, netArs: 7374 };

function mockQuery(state: {
  data?: TransactionDetail;
  isError?: boolean;
  error?: unknown;
}) {
  mockUseTransaction.mockReturnValue({
    data: state.data,
    isError: state.isError ?? false,
    error: state.error,
    refetch: mockRefetch,
  });
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

describe("PaymentTransactionDetailScreen (MOVO-304)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: "tx-1", role: "sender" };
  });

  describe("detalle de un pago (AC10)", () => {
    it("muestra monto, estado, fecha, tarjeta y el reembolso vinculado con su monto", async () => {
      mockQuery({ data: detail() });
      const { getByTestId, getByText } = await render(<PaymentTransactionDetailScreen />);

      expect(getByText("Detalle del pago")).toBeTruthy();
      expect(getByText("Pagaste")).toBeTruthy();
      expect(getByTestId("transaction-hero-amount")).toHaveTextContent("$5.200");
      expect(within(getByTestId("transaction-hero-pill")).getByText("Reembolsado parcialmente")).toBeTruthy();
      expect(getByText("4 oct 2026 · 14:32 h")).toBeTruthy();
      expect(within(getByTestId("transaction-card")).getByText("Mastercard •••• 1881")).toBeTruthy();

      const refund = getByTestId("transaction-movement-refund");
      expect(within(refund).getByText("Reembolso parcial")).toBeTruthy();
      expect(within(refund).getByText("8 oct · 10:00 h · $1.500 devueltos a tu tarjeta")).toBeTruthy();
      expect(within(refund).getByText("Vinculado al pago de $5.200 del 4 oct.")).toBeTruthy();
    });

    it("la línea de tiempo arranca por la reserva y suma el cobro, los dos con día y hora", async () => {
      mockQuery({ data: detail() });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      const movements = getByTestId("transaction-movements");
      expect(within(movements).getByText("Fondos reservados")).toBeTruthy();
      expect(within(movements).getByText("4 oct · 14:32 h · $5.200")).toBeTruthy();
      expect(within(movements).getByText("Pago cobrado")).toBeTruthy();
      expect(within(movements).getByText("6 oct · 09:00 h · al entregarse el envío")).toBeTruthy();
    });

    it("un hold liberado muestra cuándo y por qué, y que no se cobró nada", async () => {
      mockQuery({
        data: detail({
          status: "released", refundedAmountArs: null, capturedAt: null, movements: [],
          releasedAt: "2026-10-17T22:30:00.000Z", releaseReason: "cancelled",
        }),
      });
      const { getByTestId, queryByTestId } = await render(<PaymentTransactionDetailScreen />);
      const released = getByTestId("transaction-step-released");
      expect(within(released).getByText("Reserva liberada")).toBeTruthy();
      expect(within(released).getByText("17 oct · 19:30 h · El envío se canceló. No se te cobró nada")).toBeTruthy();
      expect(queryByTestId("transaction-step-pending-capture")).toBeNull();
    });

    it("una reserva vencida lo dice, y sin fecha de liberación no inventa una", async () => {
      mockQuery({
        data: detail({ status: "released", refundedAmountArs: null, capturedAt: null, movements: [], releasedAt: null, releaseReason: "expired" }),
      });
      const { getByText } = await render(<PaymentTransactionDetailScreen />);
      expect(getByText("La reserva venció. No se te cobró nada")).toBeTruthy();
    });

    it("un pago reservado todavía no tiene cobro acreditado ni movimientos", async () => {
      mockQuery({ data: detail({ status: "reserved", refundedAmountArs: null, capturedAt: null, movements: [] }) });
      const { getByTestId, queryByText } = await render(<PaymentTransactionDetailScreen />);
      expect(within(getByTestId("transaction-movements")).getByText("Fondos reservados")).toBeTruthy();
      // Mientras no se cobró ni se liberó, se ve el paso que falta.
      expect(within(getByTestId("transaction-step-pending-capture")).getByText("Se cobra cuando se entregue el envío")).toBeTruthy();
      expect(queryByText("Pago cobrado")).toBeNull();
      expect(within(getByTestId("transaction-hero-pill")).getByText("Reservado")).toBeTruthy();
    });

    it("un pago de saldo no tiene envío, movimientos ni reembolsos: muestra la tarjeta y a qué se aplicó", async () => {
      mockQuery({
        data: detail({ kind: "balance_payment", shipmentId: null, status: "completed", refundedAmountArs: null, capturedAt: null, movements: [] }),
      });
      const { getByTestId, queryByTestId, queryByText } = await render(<PaymentTransactionDetailScreen />);
      expect(within(getByTestId("transaction-card")).getByText("Mastercard •••• 1881")).toBeTruthy();
      expect(getByTestId("transaction-balance-note")).toBeTruthy();
      expect(queryByTestId("transaction-shipment-link")).toBeNull();
      expect(queryByTestId("transaction-movements")).toBeNull();
      expect(queryByText("Envío")).toBeNull();
    });

    it("el recargo por la deuda del emisor se aclara en el detalle", async () => {
      mockQuery({ data: detail({ debtAmountArs: 250 }) });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(within(getByTestId("transaction-debt-note")).getByText("Incluye $250 de tu saldo")).toBeTruthy();
    });

    it("el método de pago muestra el nombre de la tarjeta guardada, su banco y si es crédito o débito", async () => {
      mockQuery({
        data: detail({ card: { brand: "visa", last4: "3704", alias: "Personal", issuerName: "Banco Galicia", paymentType: "credit_card" } }),
      });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      const card = getByTestId("transaction-card");
      expect(within(card).getByText("Personal")).toBeTruthy();
      expect(within(card).getByText("Visa •••• 3704 · Galicia · Crédito")).toBeTruthy();
      // Los logos son decorativos (ocultos para accesibilidad): el texto ya dice banco y marca.
      expect(getByTestId("transaction-card-bank", { includeHiddenElements: true })).toBeTruthy();
      expect(getByTestId("transaction-card-brand", { includeHiddenElements: true })).toBeTruthy();
    });

    it("sin alias ni banco el método de pago queda en marca y últimos 4, sin repetirlos", async () => {
      mockQuery({ data: detail({ card: { brand: "master", last4: "1881" } }) });
      const { getByTestId, queryByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(within(getByTestId("transaction-card")).getByText("Mastercard •••• 1881")).toBeTruthy();
      expect(queryByTestId("transaction-card-bank", { includeHiddenElements: true })).toBeNull();
    });

    it("sin datos de tarjeta no se muestra la sección de método de pago", async () => {
      mockQuery({ data: detail({ card: null }) });
      const { queryByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(queryByTestId("transaction-card")).toBeNull();
    });

    it("con role=sender nunca se muestra el desglose del transportista", async () => {
      mockQuery({ data: detail({ status: "completed", breakdown: BREAKDOWN }) });
      const { queryByTestId, queryByText } = await render(<PaymentTransactionDetailScreen />);
      expect(queryByTestId("transaction-breakdown")).toBeNull();
      expect(queryByText("Te queda")).toBeNull();
      expect(queryByText("Comisión de Movo")).toBeNull();
    });

    it("un reembolso total no se llama parcial", async () => {
      mockQuery({ data: detail({ refundedAmountArs: 5200, movements: [{ kind: "refund", amountArs: 5200, date: "2026-10-08T13:00:00.000Z" }] }) });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(within(getByTestId("transaction-hero-pill")).getByText("Reembolsado")).toBeTruthy();
      expect(within(getByTestId("transaction-movement-refund")).getByText("Reembolso")).toBeTruthy();
    });

    it("consulta el detalle con el id y el rol de la ruta", async () => {
      mockQuery({ data: detail() });
      await render(<PaymentTransactionDetailScreen />);
      expect(mockUseTransaction).toHaveBeenCalledWith("tx-1", "sender");
    });
  });

  describe("detalle de un cobro (AC11)", () => {
    beforeEach(() => {
      mockParams = { id: "tx-1", role: "carrier" };
    });

    it("cobrado: lo que pagó el emisor, comisión de MP, comisión de Movo y 'Te queda'", async () => {
      mockQuery({
        data: detail({ status: "completed", amountArs: 8900, refundedAmountArs: null, card: undefined, movements: [], breakdown: BREAKDOWN }),
      });
      const { getByTestId, getByText } = await render(<PaymentTransactionDetailScreen />);

      expect(getByText("Detalle del cobro")).toBeTruthy();
      expect(getByText("Te acreditaron")).toBeTruthy();
      expect(getByTestId("transaction-hero-amount")).toHaveTextContent("$7.374");
      expect(within(getByTestId("transaction-hero-pill")).getByText("Cobrado")).toBeTruthy();
      expect(within(getByTestId("breakdown-gross")).getByText("$8.900")).toBeTruthy();
      expect(within(getByTestId("breakdown-mp-fee")).getByText("− $365")).toBeTruthy();
      expect(within(getByTestId("breakdown-commission")).getByText("− $1.161")).toBeTruthy();
      expect(within(getByTestId("breakdown-net")).getByText("Te queda")).toBeTruthy();
      expect(within(getByTestId("breakdown-net")).getByText("$7.374")).toBeTruthy();
      expect(getByText("Acreditado en tu cuenta vinculada")).toBeTruthy();
    });

    it("sin deuda descontada no hay fila de saldo pendiente", async () => {
      mockQuery({ data: detail({ status: "completed", movements: [], card: undefined, breakdown: BREAKDOWN }) });
      const { queryByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(queryByTestId("breakdown-debt")).toBeNull();
    });

    it("con deuda descontada suma la fila y el neto la refleja", async () => {
      mockQuery({
        data: detail({
          status: "completed",
          movements: [],
          card: undefined,
          breakdown: { ...BREAKDOWN, debtOffsetArs: 500, netArs: 6874 },
        }),
      });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(within(getByTestId("breakdown-debt")).getByText("− $500")).toBeTruthy();
      expect(within(getByTestId("breakdown-net")).getByText("$6.874")).toBeTruthy();
    });

    it("reservado: no se muestra el neto, solo lo que pagó el emisor", async () => {
      mockQuery({
        data: detail({ status: "reserved", amountArs: 12450, refundedAmountArs: null, capturedAt: null, card: undefined, movements: [], breakdown: null }),
      });
      const { getByTestId, getByText, queryByText, queryByTestId } = await render(<PaymentTransactionDetailScreen />);

      expect(getByText("Pagó el emisor")).toBeTruthy();
      expect(getByTestId("transaction-hero-amount")).toHaveTextContent("$12.450");
      expect(queryByText("Te acreditaron")).toBeNull();
      expect(queryByText("Te queda")).toBeNull();
      expect(queryByTestId("transaction-breakdown")).toBeNull();
      expect(getByTestId("transaction-breakdown-pending")).toBeTruthy();
      expect(queryByText("Cuenta que cobró")).toBeNull();
    });

    it("aunque el backend mandara un desglose con el cobro sin acreditar, no se muestra el neto", async () => {
      mockQuery({
        data: detail({ status: "reserved", amountArs: 12450, card: undefined, movements: [], breakdown: BREAKDOWN }),
      });
      const { queryByText, queryByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(queryByTestId("transaction-breakdown")).toBeNull();
      expect(queryByText("Te queda")).toBeNull();
      expect(queryByText("Te acreditaron")).toBeNull();
    });

    it("en disputa: sin neto, con la pill de disputa", async () => {
      mockQuery({ data: detail({ status: "disputed", refundedAmountArs: null, card: undefined, movements: [], breakdown: null }) });
      const { getByTestId, queryByText } = await render(<PaymentTransactionDetailScreen />);
      expect(within(getByTestId("transaction-hero-pill")).getByText("En disputa")).toBeTruthy();
      expect(queryByText("Te queda")).toBeNull();
    });

    it("consulta el detalle con role=carrier", async () => {
      mockQuery({ data: detail({ status: "completed", breakdown: BREAKDOWN }) });
      await render(<PaymentTransactionDetailScreen />);
      expect(mockUseTransaction).toHaveBeenCalledWith("tx-1", "carrier");
    });
  });

  describe("navegación (AC12)", () => {
    it("'Ver el envío' navega a /shipments/:id desde un pago", async () => {
      mockQuery({ data: detail() });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      await press(getByTestId("transaction-shipment-link"));
      expect(mockPush).toHaveBeenCalledWith(`/shipments/${SHIPMENT_ID}`);
    });

    it("'Ver el envío' navega a /shipments/:id desde un cobro", async () => {
      mockParams = { id: "tx-1", role: "carrier" };
      mockQuery({ data: detail({ status: "completed", breakdown: BREAKDOWN }) });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      await press(getByTestId("transaction-shipment-link"));
      expect(mockPush).toHaveBeenCalledWith(`/shipments/${SHIPMENT_ID}`);
    });

    it("el botón de volver navega hacia atrás", async () => {
      mockQuery({ data: detail() });
      const { getByTestId } = await render(<PaymentTransactionDetailScreen />);
      await press(getByTestId("transaction-detail-back"));
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  describe("estados de pantalla (AC13)", () => {
    it("muestra un skeleton mientras carga", async () => {
      mockQuery({});
      const { getByTestId, queryByTestId } = await render(<PaymentTransactionDetailScreen />);
      expect(getByTestId("transaction-detail-loading")).toBeTruthy();
      expect(queryByTestId("transaction-hero")).toBeNull();
    });

    it("un 404 se muestra como 'No encontramos esta transacción', sin reintentar ni pantalla en blanco", async () => {
      mockQuery({ isError: true, error: new ApiError(404, "NOT_FOUND", "not found") });
      const { getByTestId, getByText, queryByTestId } = await render(<PaymentTransactionDetailScreen />);

      expect(getByTestId("transaction-not-found")).toBeTruthy();
      expect(getByText("No encontramos esta transacción")).toBeTruthy();
      expect(queryByTestId("transaction-not-found-retry")).toBeNull();
      expect(queryByTestId("transaction-detail-loading")).toBeNull();
    });

    it("otro error muestra el mensaje y 'Reintentar'", async () => {
      mockQuery({ isError: true, error: new ApiError(500, "INTERNAL_ERROR", "boom") });
      const { getByTestId, getByText } = await render(<PaymentTransactionDetailScreen />);

      expect(getByText("Ocurrió un error inesperado. Intentá de nuevo en unos minutos.")).toBeTruthy();
      await press(getByTestId("transaction-detail-error-retry"));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it("un rol ausente o inválido en la ruta se trata como pago", async () => {
      mockParams = { id: "tx-1", role: "admin" };
      mockQuery({ data: detail() });
      const { getByText } = await render(<PaymentTransactionDetailScreen />);
      expect(getByText("Detalle del pago")).toBeTruthy();
      expect(mockUseTransaction).toHaveBeenCalledWith("tx-1", "sender");
    });
  });
});

describe("PaymentTransactionDetailScreen — envío en efectivo (MOVO-37)", () => {
  const cash = (overrides: Partial<TransactionDetail> = {}) =>
    detail({
      kind: "cash_shipment",
      amountArs: 8900,
      status: "completed",
      refundedAmountArs: null,
      card: null,
      movements: [],
      ...overrides,
    });

  beforeEach(() => jest.clearAllMocks());

  it("el emisor ve que pagó en efectivo, sin tarjeta ni línea de tiempo de la reserva", async () => {
    mockParams = { id: "tx-1", role: "sender" };
    mockQuery({ data: cash() });
    const { getByTestId, getByText, queryByTestId } = await render(<PaymentTransactionDetailScreen />);

    expect(getByText("Pagaste en efectivo")).toBeTruthy();
    expect(getByTestId("transaction-cash")).toBeTruthy();
    expect(queryByTestId("transaction-card")).toBeNull();
    expect(queryByTestId("transaction-cash-breakdown")).toBeNull();
  });

  it("el transportista ve lo cobrado en mano y la comisión como saldo, sin comisión de Mercado Pago", async () => {
    mockParams = { id: "tx-1", role: "carrier" };
    mockQuery({ data: cash({ breakdown: { grossArs: 8900, mpFeeArs: 0, commissionArs: 1161, debtOffsetArs: 0, netArs: 7739 } }) });
    const { getByTestId, getByText, queryByTestId } = await render(<PaymentTransactionDetailScreen />);

    expect(within(getByTestId("transaction-hero")).getByText("Cobraste en efectivo")).toBeTruthy();
    expect(within(getByTestId("transaction-hero")).getByText("$8.900")).toBeTruthy();
    expect(getByTestId("transaction-cash-breakdown")).toBeTruthy();
    expect(queryByTestId("breakdown-mp-fee")).toBeNull();

    await press(getByTestId("transaction-cash-balance-link"));
    expect(mockPush).toHaveBeenCalledWith("/profile/payments?tab=balance");
  });
});
