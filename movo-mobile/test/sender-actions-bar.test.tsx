import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fireEvent, render } from "@testing-library/react-native";
import { SenderActionsBar } from "../components/shipments/sender-actions-bar";

const mockMutateCancel = jest.fn();
let mockCancelState = { isPending: false };

jest.mock("../src/hooks/use-shipments", () => ({
  useCancelShipment: () => ({
    mutateAsync: mockMutateCancel,
    isPending: mockCancelState.isPending,
  }),
}));

// Mismo criterio que el mock de `@react-native-community/datetimepicker`
// (`test/time-window-picker.test.tsx`): el componente nativo real no tiene
// representación en el árbol de React (el menú lo dibuja SwiftUI/Android, no JS),
// así que el mock simula cada `action` como una fila tocable que dispara
// `onPressAction` con el mismo `nativeEvent.event` que el componente real.
jest.mock("@react-native-menu/menu", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    MenuView: ({ testID, actions, onPressAction, onOpenMenu, children }: any) => (
      <View testID={testID}>
        <Pressable
          testID={`${testID}-open`}
          onPress={() => {
            onOpenMenu?.();
          }}
        >
          {children}
        </Pressable>
        {actions.map((action: any) => (
          <Pressable
            key={action.id}
            testID={`${testID}-action-${action.id}`}
            onPress={() => onPressAction?.({ nativeEvent: { event: action.id } })}
          >
            <Text>{action.title}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

/** Simula elegir "Cancelar envío" del menú nativo (mockeado arriba). */
async function pressCancelAction(getByTestId: (id: string) => any) {
  await fireEvent.press(getByTestId("actions-menu-action-cancel-shipment"));
}

describe("SenderActionsBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelState = { isPending: false };
  });

  it("renderiza el botón de menú (tres puntos) y la acción de cancelar", async () => {
    const { getByTestId, getByText } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    expect(getByTestId("actions-menu-button")).toBeTruthy();
    expect(getByTestId("actions-menu-action-cancel-shipment")).toBeTruthy();
    expect(getByText("Cancelar envío")).toBeTruthy();
  });

  it("al elegir 'Cancelar envío' del menú nativo, abre el modal de confirmación con motivo opcional", async () => {
    const { getByTestId, queryByTestId } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    expect(queryByTestId("actions-cancel-reason-input")).toBeNull();

    await pressCancelAction(getByTestId);

    expect(getByTestId("actions-cancel-modal")).toBeTruthy();
    expect(getByTestId("actions-cancel-reason-input")).toBeTruthy();
    expect(getByTestId("actions-cancel-confirm-button")).toBeTruthy();
  });

  it("al confirmar cancelación con motivo, llama a mutateAsync con reason", async () => {
    mockMutateCancel.mockResolvedValueOnce({ id: "shipment-1", status: "cancelled" });

    const { getByTestId } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await pressCancelAction(getByTestId);
    await fireEvent.changeText(getByTestId("actions-cancel-reason-input"), "Me equivoqué de receptor");
    await fireEvent.press(getByTestId("actions-cancel-confirm-button"));

    expect(mockMutateCancel).toHaveBeenCalledWith({
      id: "shipment-1",
      reason: "Me equivoqué de receptor",
    });
  });

  it("al confirmar cancelación con motivo vacío, llama a mutateAsync con reason undefined", async () => {
    mockMutateCancel.mockResolvedValueOnce({ id: "shipment-1", status: "cancelled" });

    const { getByTestId } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await pressCancelAction(getByTestId);
    await fireEvent.press(getByTestId("actions-cancel-confirm-button"));

    expect(mockMutateCancel).toHaveBeenCalledWith({
      id: "shipment-1",
      reason: undefined,
    });
  });

  it("el botón 'Volver' cierra el modal sin cancelar", async () => {
    const { getByTestId, queryByTestId } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await pressCancelAction(getByTestId);
    await fireEvent.press(getByTestId("actions-cancel-dismiss-button"));

    expect(queryByTestId("actions-cancel-reason-input")).toBeNull();
    expect(mockMutateCancel).not.toHaveBeenCalled();
  });

  it("maneja error 403 mostrando 'No sos el emisor de este envío.' sin cerrar el modal", async () => {
    mockMutateCancel.mockRejectedValueOnce(new ApiError(403, "AUTH_FORBIDDEN", "forbidden"));

    const { getByTestId, findByText } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await pressCancelAction(getByTestId);
    await fireEvent.press(getByTestId("actions-cancel-confirm-button"));

    expect(await findByText("No sos el emisor de este envío.")).toBeTruthy();
    expect(getByTestId("actions-cancel-reason-input")).toBeTruthy();
  });

  it("maneja error 404 mostrando 'Este envío ya no existe.'", async () => {
    mockMutateCancel.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "not found"));

    const { getByTestId, findByText } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    await pressCancelAction(getByTestId);
    await fireEvent.press(getByTestId("actions-cancel-confirm-button"));

    expect(await findByText("Este envío ya no existe.")).toBeTruthy();
  });

  it("maneja error 409 SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED con mensaje específico y dispara onRefetch", async () => {
    const mockRefetch = jest.fn();
    mockMutateCancel.mockRejectedValueOnce(
      new ApiError(409, "SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED", "conflict"),
    );

    const { getByTestId, findByText } = await render(
      <SenderActionsBar shipmentId="shipment-1" onRefetch={mockRefetch} testID="actions" />,
    );

    await pressCancelAction(getByTestId);
    await fireEvent.press(getByTestId("actions-cancel-confirm-button"));

    expect(
      await findByText(
        "Este envío ya tiene un transportista asignado y no se puede cancelar desde la app todavía.",
      ),
    ).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("maneja error 409 SHIPMENT_INVALID_TRANSITION con mensaje genérico y dispara onRefetch", async () => {
    const mockRefetch = jest.fn();
    mockMutateCancel.mockRejectedValueOnce(
      new ApiError(409, "SHIPMENT_INVALID_TRANSITION", "conflict"),
    );

    const { getByTestId, findByText } = await render(
      <SenderActionsBar shipmentId="shipment-1" onRefetch={mockRefetch} testID="actions" />,
    );

    await pressCancelAction(getByTestId);
    await fireEvent.press(getByTestId("actions-cancel-confirm-button"));

    expect(await findByText("Este envío ya no se puede cancelar.")).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("deshabilita el botón de menú (pointerEvents+opacidad) mientras la mutación está en vuelo", async () => {
    mockCancelState = { isPending: true };

    const { getByTestId } = await render(
      <SenderActionsBar shipmentId="shipment-1" testID="actions" />,
    );

    const wrapper = getByTestId("actions-menu-wrapper");
    expect(wrapper.props.pointerEvents).toBe("none");
    expect(wrapper.props.style?.opacity).toBe(0.5);
  });
});
