import { fireEvent, render } from "@testing-library/react-native";
import { DeliveryPaymentStatus } from "../components/payments/delivery-payment-status";

const mockUseShipmentSettlement = jest.fn();
jest.mock("../src/hooks/use-shipment-settlement", () => ({
  useShipmentSettlement: (...args: unknown[]) => mockUseShipmentSettlement(...args),
}));

function settlementReturns(data: unknown, isError = false) {
  mockUseShipmentSettlement.mockReturnValue({ data, isError, isLoading: false, refetch: jest.fn() });
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
    ["sin liquidación todavía", null, false],
    ["con la liquidación en proceso", { status: "processing", paidAmountArs: 13800, paidAt: null, netAmountArs: null }, false],
    ["si la consulta falla", undefined, true],
  ])("%s dice que se está cobrando, sin monto", async (_label, data, isError) => {
    settlementReturns(data, isError);

    const { getByTestId, queryByText } = await render(<DeliveryPaymentStatus shipmentId="s-1" testID="dps" />);

    expect(getByTestId("dps-processing")).toHaveTextContent(/Estamos cobrando el envío/);
    expect(queryByText(/\$/)).toBeNull();
  });

  it("con la liquidación escalada avisa que el cobro está demorado", async () => {
    settlementReturns({ status: "escalated", paidAmountArs: 13800, paidAt: null, netAmountArs: null });

    const { getByTestId } = await render(<DeliveryPaymentStatus shipmentId="s-1" testID="dps" />);

    expect(getByTestId("dps-escalated")).toHaveTextContent(/Tu cobro está demorado/);
  });
});
