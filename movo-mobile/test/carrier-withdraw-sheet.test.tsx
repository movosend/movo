import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fireEvent, render } from "@testing-library/react-native";
import { CarrierWithdrawSheet } from "../components/shipments/carrier-withdraw-sheet";

const mockQuote = jest.fn();
const mockWithdraw = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useCarrierWithdrawalQuote: () => ({ mutateAsync: mockQuote }),
  useCarrierWithdraw: () => ({ mutateAsync: mockWithdraw, isPending: false }),
}));

const FREE_UNTIL = "2026-10-16T11:00:00.000Z";
const freeQuote = { penaltyArs: 0, reason: "before_free_deadline", freeUntil: FREE_UNTIL };
const debtQuote = (penaltyArs: number) => ({ penaltyArs, reason: "late_cancellation", freeUntil: FREE_UNTIL });

function renderSheet(overrides: Partial<{ onWithdrawn: jest.Mock; onRefetch: jest.Mock; onClose: jest.Mock }> = {}) {
  const props = { onWithdrawn: jest.fn(), onRefetch: jest.fn(), onClose: jest.fn(), ...overrides };
  const utils = render(
    <CarrierWithdrawSheet
      visible
      shipmentId="shipment-1"
      senderFirstName="Lucía"
      onClose={props.onClose}
      onWithdrawn={props.onWithdrawn}
      onRefetch={props.onRefetch}
      testID="sheet"
    />,
  );
  return { ...props, utils };
}

describe("CarrierWithdrawSheet (MOVO-314)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sin cargo: lo dice, confirma con expectedPenaltyArs 0 y avisa el éxito", async () => {
    mockQuote.mockResolvedValueOnce(freeQuote);
    mockWithdraw.mockResolvedValueOnce({});
    const { utils, onWithdrawn } = renderSheet();
    const { findByTestId, getByTestId, getByText } = await utils;

    expect(await findByTestId("sheet-free")).toHaveTextContent(
      "No tiene ningún cargo. Le avisamos a Lucía y el envío vuelve a publicarse para otros transportistas.",
    );
    expect(getByText("Cancelar el envío")).toBeTruthy();

    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(mockWithdraw).toHaveBeenCalledWith({ id: "shipment-1", expectedPenaltyArs: 0 });
    expect(onWithdrawn).toHaveBeenCalledWith("Cancelaste el envío. Ya no está en tu viaje.");
  });

  it("AC2: con deuda muestra el monto y que se descuenta de los próximos cobros", async () => {
    mockQuote.mockResolvedValueOnce(debtQuote(2450));
    mockWithdraw.mockResolvedValueOnce({});
    const { utils, onWithdrawn } = renderSheet();
    const { findByTestId, getByTestId, getByText } = await utils;

    expect(await findByTestId("sheet-debt")).toHaveTextContent(
      "Se te va a registrar una deuda de $2.450 que se descuenta de tus próximos cobros.",
    );
    expect(getByTestId("sheet-debt-lead")).toHaveTextContent("Faltan menos de 12 h para el retiro. Lucía ya contaba con vos.");
    expect(getByText("Cancelar igual")).toBeTruthy();

    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(mockWithdraw).toHaveBeenCalledWith({ id: "shipment-1", expectedPenaltyArs: 2450 });
    expect(onWithdrawn).toHaveBeenCalledWith("Cancelaste el envío. Registramos una deuda de $2.450.");
  });

  it("si la cotización falla, permite reintentar", async () => {
    mockQuote.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "boom")).mockResolvedValueOnce(freeQuote);
    const { utils } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    expect(await findByTestId("sheet-quote-error")).toBeTruthy();
    await fireEvent.press(getByTestId("sheet-retry"));
    expect(await findByTestId("sheet-free")).toBeTruthy();
    expect(mockQuote).toHaveBeenCalledTimes(2);
  });

  it("409 CANCELLATION_PENALTY_MISMATCH: re-cotiza, avisa el monto nuevo y confirma con ese monto", async () => {
    mockQuote.mockResolvedValueOnce(freeQuote).mockResolvedValueOnce(debtQuote(2450));
    mockWithdraw
      .mockRejectedValueOnce(new ApiError(409, "CANCELLATION_PENALTY_MISMATCH", "cambió", { penaltyArs: 2450 }))
      .mockResolvedValueOnce({});
    const { utils, onWithdrawn } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    await findByTestId("sheet-free");
    await fireEvent.press(getByTestId("sheet-confirm"));

    expect(await findByTestId("sheet-mismatch")).toBeTruthy();
    expect(getByTestId("sheet-debt")).toHaveTextContent(/\$2\.450/);
    expect(onWithdrawn).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(mockWithdraw).toHaveBeenLastCalledWith({ id: "shipment-1", expectedPenaltyArs: 2450 });
    expect(onWithdrawn).toHaveBeenCalledTimes(1);
  });

  it("409 de estado al confirmar: refresca y explica que ya no se puede", async () => {
    mockQuote.mockResolvedValueOnce(freeQuote);
    mockWithdraw.mockRejectedValueOnce(new ApiError(409, "SHIPMENT_INVALID_TRANSITION", "no"));
    const { utils, onRefetch, onWithdrawn } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    await findByTestId("sheet-free");
    await fireEvent.press(getByTestId("sheet-confirm"));

    expect(await findByTestId("sheet-blocked-text")).toBeTruthy();
    expect(onRefetch).toHaveBeenCalledTimes(1);
    expect(onWithdrawn).not.toHaveBeenCalled();
  });

  it("409 de estado al cotizar: va directo al bloqueo", async () => {
    mockQuote.mockRejectedValueOnce(new ApiError(409, "SHIPMENT_INVALID_TRANSITION", "no"));
    const { utils } = renderSheet();
    const { findByTestId } = await utils;

    expect(await findByTestId("sheet-blocked-text")).toBeTruthy();
  });

  it("un error de red al confirmar queda dentro del sheet para reintentar", async () => {
    mockQuote.mockResolvedValueOnce(freeQuote);
    mockWithdraw.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "boom"));
    const { utils, onWithdrawn } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    await findByTestId("sheet-free");
    await fireEvent.press(getByTestId("sheet-confirm"));

    expect(await findByTestId("sheet-confirm-error")).toHaveTextContent("No pudimos cancelar el envío. Probá de nuevo.");
    expect(onWithdrawn).not.toHaveBeenCalled();
  });
});
