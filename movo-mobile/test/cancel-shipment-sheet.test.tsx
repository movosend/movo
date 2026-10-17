import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import { CancelShipmentSheet } from "../components/shipments/cancel-shipment-sheet";
import { formatCancellationDateTime, PICKUP_WINDOW_CLOSED_REASON } from "../src/lib/cancellation-format";

const mockQuote = jest.fn();
const mockCancel = jest.fn();

jest.mock("../src/hooks/use-shipments", () => ({
  useCancellationQuote: () => ({ mutateAsync: mockQuote }),
  useCancelShipment: () => ({ mutateAsync: mockCancel, isPending: false }),
}));

const ASSIGNED = { id: "shipment-1", status: ShipmentStatus.ASSIGNED, agreedPriceArs: 18500 };
const FREE_UNTIL = "2026-10-16T11:00:00.000Z";

const freeQuote = { penaltyArs: 0, reason: "before_free_deadline", freeUntil: FREE_UNTIL };
const penaltyQuote = (penaltyArs: number) => ({ penaltyArs, reason: "late_cancellation", freeUntil: FREE_UNTIL });
const closedQuote = { penaltyArs: 0, reason: "pickup_window_closed", freeUntil: FREE_UNTIL };

function renderSheet(
  overrides: Partial<{
    shipment: typeof ASSIGNED;
    onRefetch: jest.Mock;
    onCancelled: jest.Mock;
  }> = {},
) {
  const props = {
    shipment: ASSIGNED,
    onRefetch: jest.fn().mockResolvedValue(ShipmentStatus.ASSIGNED),
    onCancelled: jest.fn(),
    ...overrides,
  };
  const utils = render(
    <CancelShipmentSheet
      visible
      shipment={props.shipment}
      carrierFirstName="Martín"
      onClose={jest.fn()}
      onCancelled={props.onCancelled}
      onRefetch={props.onRefetch}
      testID="sheet"
    />,
  );
  return { ...props, utils };
}

describe("CancelShipmentSheet (MOVO-308)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sin cargo: muestra hasta cuándo, cuánto se libera y confirma con penalidad 0", async () => {
    mockQuote.mockResolvedValueOnce(freeQuote);
    mockCancel.mockResolvedValueOnce({});
    const { utils, onCancelled } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    const text = await findByTestId("sheet-free");
    expect(text).toHaveTextContent(
      `Podés cancelar sin cargo hasta el ${formatCancellationDateTime(FREE_UNTIL)}. Te liberamos los $18.500 reservados y le avisamos a Martín.`,
    );

    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(mockCancel).toHaveBeenCalledWith({ id: "shipment-1", reason: undefined, expectedPenaltyArs: 0 });
    expect(onCancelled).toHaveBeenCalledWith("Cancelaste el envío. Le avisamos a Martín.");
  });

  it("con penalidad: muestra el monto, lo reservado y lo que se libera, y lo manda al confirmar con el motivo", async () => {
    mockQuote.mockResolvedValueOnce(penaltyQuote(4625));
    mockCancel.mockResolvedValueOnce({});
    const { utils } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    expect(await findByTestId("sheet-penalty")).toHaveTextContent(
      "Se te cobrará $4.625 de los $18.500 reservados. El resto se libera en tu tarjeta.",
    );
    expect(getByTestId("sheet-penalty-amount")).toHaveTextContent("− $4.625");
    expect(getByTestId("sheet-released-amount")).toHaveTextContent("$13.875");

    await fireEvent.changeText(getByTestId("sheet-reason-input"), "Cambié de planes");
    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(mockCancel).toHaveBeenCalledWith({ id: "shipment-1", reason: "Cambié de planes", expectedPenaltyArs: 4625 });
  });

  it("ventana vencida: sin cargo, con el motivo", async () => {
    mockQuote.mockResolvedValueOnce(closedQuote);
    const { utils } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    expect(await findByTestId("sheet-expired")).toHaveTextContent(
      "Ya pasó el plazo para cancelar sin cargo, pero esta vez no se te cobra nada. Te liberamos los $18.500 reservados.",
    );
    expect(getByTestId("sheet-expired-reason")).toHaveTextContent(PICKUP_WINDOW_CLOSED_REASON);
  });

  it("sin reserva (estado previo a assigned): no cotiza y no manda expectedPenaltyArs", async () => {
    mockCancel.mockResolvedValueOnce({});
    const { utils } = renderSheet({ shipment: { ...ASSIGNED, status: ShipmentStatus.PUBLISHED } });
    const { getByTestId } = await utils;

    expect(getByTestId("sheet-no-hold")).toBeTruthy();
    expect(mockQuote).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(mockCancel).toHaveBeenCalledWith({ id: "shipment-1", reason: undefined });
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
    mockQuote.mockResolvedValueOnce(penaltyQuote(3700)).mockResolvedValueOnce(penaltyQuote(5550));
    mockCancel
      .mockRejectedValueOnce(new ApiError(409, "CANCELLATION_PENALTY_MISMATCH", "cambió", { penaltyArs: 5550 }))
      .mockResolvedValueOnce({});
    const { utils, onCancelled } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    await findByTestId("sheet-penalty");
    await fireEvent.press(getByTestId("sheet-confirm"));

    expect(await findByTestId("sheet-mismatch-body")).toHaveTextContent(
      "La penalidad pasó de $3.700 a $5.550 porque se acercó la hora del retiro.",
    );
    expect(getByTestId("sheet-penalty-amount")).toHaveTextContent("− $5.550");
    expect(mockQuote).toHaveBeenCalledTimes(2);
    expect(onCancelled).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(mockCancel).toHaveBeenLastCalledWith({ id: "shipment-1", reason: undefined, expectedPenaltyArs: 5550 });
    expect(onCancelled).toHaveBeenCalled();
  });

  it("409 de monto que baja a 0 (la franja cerró): avisa que ya no hay penalidad", async () => {
    mockQuote.mockResolvedValueOnce(penaltyQuote(4625)).mockResolvedValueOnce(closedQuote);
    mockCancel.mockRejectedValueOnce(new ApiError(409, "CANCELLATION_PENALTY_MISMATCH", "cambió", { penaltyArs: 0 }));
    const { utils } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    await findByTestId("sheet-penalty");
    await fireEvent.press(getByTestId("sheet-confirm"));

    expect(await findByTestId("sheet-mismatch-body")).toHaveTextContent(
      "Ya no corresponde cobrarte la penalidad de $4.625.",
    );
    expect(getByTestId("sheet-expired")).toBeTruthy();
  });

  it("si la cancelación falla por otro motivo, muestra el error y deja reintentar", async () => {
    mockQuote.mockResolvedValueOnce(freeQuote);
    mockCancel.mockRejectedValueOnce(new ApiError(502, "PAYMENT_PROVIDER_ERROR", "mp"));
    const { utils } = renderSheet();
    const { findByTestId, getByTestId } = await utils;

    await findByTestId("sheet-free");
    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(await findByTestId("sheet-confirm-error")).toHaveTextContent("No pudimos cancelar el envío. Probá de nuevo.");
    expect(getByTestId("sheet-confirm")).toBeTruthy();
  });

  it("409 de estado con el paquete ya retirado: explica el retiro", async () => {
    mockQuote.mockResolvedValueOnce(freeQuote);
    mockCancel.mockRejectedValueOnce(new ApiError(409, "SHIPMENT_CONCURRENT_MODIFICATION", "carrera"));
    const onRefetch = jest.fn().mockResolvedValue(ShipmentStatus.IN_TRANSIT);
    const { utils } = renderSheet({ onRefetch });
    const { findByTestId, getByTestId } = await utils;

    await findByTestId("sheet-free");
    await fireEvent.press(getByTestId("sheet-confirm"));
    expect(await findByTestId("sheet-blocked-text")).toHaveTextContent(
      "Martín ya retiró el paquete. Si hay un problema, escribile por el chat del envío.",
    );
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("409 de estado al cotizar sin retiro: explica que el estado cambió", async () => {
    mockQuote.mockRejectedValueOnce(new ApiError(409, "SHIPMENT_INVALID_TRANSITION", "no"));
    const onRefetch = jest.fn().mockResolvedValue(ShipmentStatus.CANCELLED);
    const { utils } = renderSheet({ onRefetch });
    const { findByTestId } = await utils;

    expect(await findByTestId("sheet-blocked-text")).toHaveTextContent(
      "El estado del envío cambió y ya no se puede cancelar.",
    );
  });
});
