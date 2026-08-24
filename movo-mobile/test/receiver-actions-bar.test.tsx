import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ReceiverActionsBar } from "../components/shipments/receiver-actions-bar";

const mockMutateAccept = jest.fn();
const mockMutateReject = jest.fn();
let mockAcceptState = { isPending: false };
let mockRejectState = { isPending: false };

jest.mock("../src/hooks/use-shipments", () => ({
  useAcceptShipment: () => ({
    mutateAsync: mockMutateAccept,
    isPending: mockAcceptState.isPending,
  }),
  useRejectShipment: () => ({
    mutateAsync: mockMutateReject,
    isPending: mockRejectState.isPending,
  }),
}));

describe("ReceiverActionsBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAcceptState = { isPending: false };
    mockRejectState = { isPending: false };
  });

  it("renderiza los botones de aceptar y rechazar", async () => {
    const { getByText, getByTestId } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    expect(getByTestId("actions-accept-button")).toBeTruthy();
    expect(getByTestId("actions-reject-button")).toBeTruthy();
    expect(getByText("Aceptar envío")).toBeTruthy();
    expect(getByText("Rechazar")).toBeTruthy();
  });

  it("muestra el tiempo restante cuando receiverConfirmationDeadline está presente", async () => {
    // Deadline a 36 horas en el futuro
    const future = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    const { getByTestId, getByText } = await render(
      <ReceiverActionsBar
        shipmentId="shipment-1"
        receiverConfirmationDeadline={future}
        testID="actions"
      />,
    );

    expect(getByTestId("actions-deadline")).toBeTruthy();
    expect(getByText(/Te quedan \d+ h para confirmar/)).toBeTruthy();
  });

  it("no muestra el indicador de deadline si receiverConfirmationDeadline es null", async () => {
    const { queryByTestId } = await render(
      <ReceiverActionsBar
        shipmentId="shipment-1"
        receiverConfirmationDeadline={null}
        testID="actions"
      />,
    );

    expect(queryByTestId("actions-deadline")).toBeNull();
  });

  it("al tocar 'Aceptar envío' abre el modal de confirmación in-app, confirma y muestra pantalla de éxito", async () => {
    const mockRefetch = jest.fn();
    mockMutateAccept.mockResolvedValueOnce({ id: "shipment-1", status: "published" });

    const { getByTestId, getByText } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" onRefetch={mockRefetch} testID="actions" />,
    );

    await fireEvent.press(getByTestId("actions-accept-button"));

    expect(getByTestId("actions-accept-modal")).toBeTruthy();
    expect(getByText("¿Aceptar este envío?")).toBeTruthy();

    await fireEvent.press(getByTestId("actions-accept-confirm-button"));

    expect(mockMutateAccept).toHaveBeenCalledWith({ id: "shipment-1" });
    expect(getByTestId("actions-success-modal")).toBeTruthy();
    expect(getByText("Envío aceptado")).toBeTruthy();

    await fireEvent.press(getByTestId("actions-success-view-button"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("al tocar 'Rechazar' abre el modal de confirmación con campo de motivo opcional", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    // Al inicio el modal no está visible
    expect(queryByTestId("actions-reject-reason-input")).toBeNull();

    await fireEvent.press(getByTestId("actions-reject-button"));

    // Modal se abre
    expect(getByTestId("actions-reject-modal")).toBeTruthy();
    expect(getByTestId("actions-reject-reason-input")).toBeTruthy();
    expect(getByTestId("actions-reject-confirm-button")).toBeTruthy();
  });

  it("al confirmar rechazo con motivo, llama a mutateAsync con reason", async () => {
    mockMutateReject.mockResolvedValueOnce({ id: "shipment-1", status: "rejected_by_receiver" });

    const { getByTestId } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await fireEvent.press(getByTestId("actions-reject-button"));
    await fireEvent.changeText(getByTestId("actions-reject-reason-input"), "No solicité este envío");
    await fireEvent.press(getByTestId("actions-reject-confirm-button"));

    expect(mockMutateReject).toHaveBeenCalledWith({
      id: "shipment-1",
      reason: "No solicité este envío",
    });
  });

  it("al confirmar rechazo con motivo vacío, llama a mutateAsync con reason undefined", async () => {
    mockMutateReject.mockResolvedValueOnce({ id: "shipment-1", status: "rejected_by_receiver" });

    const { getByTestId } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await fireEvent.press(getByTestId("actions-reject-button"));
    await fireEvent.press(getByTestId("actions-reject-confirm-button"));

    expect(mockMutateReject).toHaveBeenCalledWith({
      id: "shipment-1",
      reason: undefined,
    });
  });

  it("maneja error 409 mostrando 'Este envío ya no se puede confirmar' y disparando onRefetch", async () => {
    const mockRefetch = jest.fn();
    mockMutateAccept.mockRejectedValueOnce(
      new ApiError(409, "SHIPMENT_INVALID_TRANSITION", "conflict"),
    );

    const { getByTestId, findByText } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" onRefetch={mockRefetch} testID="actions" />,
    );

    await fireEvent.press(getByTestId("actions-accept-button"));
    await fireEvent.press(getByTestId("actions-accept-confirm-button"));

    expect(await findByText("Este envío ya no se puede confirmar.")).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("maneja error 403 mostrando 'No sos el destinatario de este envío.'", async () => {
    mockMutateAccept.mockRejectedValueOnce(
      new ApiError(403, "AUTH_FORBIDDEN", "forbidden"),
    );

    const { getByTestId, findByText } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await fireEvent.press(getByTestId("actions-accept-button"));
    await fireEvent.press(getByTestId("actions-accept-confirm-button"));

    expect(await findByText("No sos el destinatario de este envío.")).toBeTruthy();
  });

  it("deshabilita los botones mientras la mutación está en vuelo", async () => {
    mockAcceptState = { isPending: true };

    const { getByTestId } = await render(
      <ReceiverActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    const acceptBtn = getByTestId("actions-accept-button");
    const rejectBtn = getByTestId("actions-reject-button");

    expect(acceptBtn.props.accessibilityState?.disabled).toBe(true);
    expect(rejectBtn.props.accessibilityState?.disabled).toBe(true);
  });
});
