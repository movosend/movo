import { fireEvent, render } from "@testing-library/react-native";
import { DeliveryPaymentStatus } from "../components/payments/delivery-payment-status";

const mockUseShipmentSettlement = jest.fn();
jest.mock("../src/hooks/use-shipment-settlement", () => ({
  useShipmentSettlement: (...args: unknown[]) => mockUseShipmentSettlement(...args),
}));

function settlementReturns(data: unknown, isError = false, isPollingTimedOut = false) {
  mockUseShipmentSettlement.mockReturnValue({
    data,
    isError,
    isPollingTimedOut,
    isLoading: false,
    refetch: jest.fn(),
  });
}

describe("DeliveryPaymentStatus (MOVO-214 AC5)", () => {
  afterEach(() => jest.clearAllMocks());

  it("con la captura acreditada muestra el neto real y lleva al detalle", async () => {
    settlementReturns({
      shipmentId: "s-1",
      role: "carrier",
      status: "credited",
      paidAmountArs: 13800,
      paidAt: "2026-10-14T19:42:00.000Z",
      mpFeeArs: 688.62,
      commissionArs: 1800,
      netAmountArs: 11311.38,
    });
    const onViewDetail = jest.fn();

    const { getByTestId } = await render(
      <DeliveryPaymentStatus shipmentId="s-1" onViewDetail={onViewDetail} testID="dps" />
    );

    expect(getByTestId("dps-net")).toHaveTextContent("$11.311,38");
    fireEvent.press(getByTestId("dps-view-detail"));
    expect(onViewDetail).toHaveBeenCalled();
  });

  it("consulta seguido mientras la pantalla está abierta", async () => {
    settlementReturns(null);

    await render(<DeliveryPaymentStatus shipmentId="s-1" testID="dps" />);

    expect(mockUseShipmentSettlement).toHaveBeenCalledWith(
      "s-1",
      expect.objectContaining({ enabled: true, pollWhileProcessingMs: expect.any(Number) })
    );
  });

  it.each([
    ["sin liquidación todavía", null],
    ["con la liquidación en proceso", { status: "processing", paidAmountArs: 13800, paidAt: null, netAmountArs: null }],
  ])("%s dice que se está cobrando, sin monto", async (_label, data) => {
    settlementReturns(data, false);

    const { getByTestId, queryByText } = await render(<DeliveryPaymentStatus shipmentId="s-1" testID="dps" />);

    expect(getByTestId("dps-processing")).toHaveTextContent(/Estamos cobrando el envío/);
    expect(queryByText(/\$/)).toBeNull();
  });

  it.each([
    ["si la consulta falla", { isError: true, isPollingTimedOut: false }],
    ["si se agota el tiempo de polling", { isError: false, isPollingTimedOut: true }],
  ])("%s muestra 'Mirá el detalle del envío' con botón 'Ver detalle'", async (_label, flags) => {
    settlementReturns(undefined, flags.isError, flags.isPollingTimedOut);
    const onViewDetail = jest.fn();

    const { getByTestId, queryByText } = await render(
      <DeliveryPaymentStatus shipmentId="s-1" onViewDetail={onViewDetail} testID="dps" />
    );

    expect(getByTestId("dps-error")).toHaveTextContent(/Mirá el detalle del envío/);
    expect(getByTestId("dps-view-detail")).toBeTruthy();
    expect(queryByText(/\$/)).toBeNull();

    fireEvent.press(getByTestId("dps-view-detail"));
    expect(onViewDetail).toHaveBeenCalledTimes(1);
  });

  it("con la liquidación escalada avisa que el cobro está demorado", async () => {
    settlementReturns({ status: "escalated", paidAmountArs: 13800, paidAt: null, netAmountArs: null });

    const { getByTestId } = await render(<DeliveryPaymentStatus shipmentId="s-1" testID="dps" />);

    expect(getByTestId("dps-escalated")).toHaveTextContent(/Tu cobro está demorado/);
    expect(getByTestId("dps-escalated")).toHaveTextContent(/a la brevedad/);
  });
});
