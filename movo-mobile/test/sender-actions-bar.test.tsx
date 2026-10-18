import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import { SenderActionsBar } from "../components/shipments/sender-actions-bar";

const mockMutateCancel = jest.fn();
let mockCancelState = { isPending: false };

jest.mock("../src/hooks/use-shipments", () => ({
  useCancelShipment: () => ({
    mutateAsync: mockMutateCancel,
    isPending: mockCancelState.isPending,
  }),
  useCancellationQuote: () => ({ mutateAsync: jest.fn() }),
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

const PUBLISHED = { id: "shipment-1", status: ShipmentStatus.PUBLISHED, agreedPriceArs: null };

function renderBar(onCancelled = jest.fn()) {
  return render(
    <SenderActionsBar
      shipment={PUBLISHED}
      onRefetch={jest.fn().mockResolvedValue(undefined)}
      onCancelled={onCancelled}
      testID="actions"
    />,
  );
}

// El sheet en sí (cotización, penalidad, 409) se prueba en `cancel-shipment-sheet.test.tsx`.
describe("SenderActionsBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelState = { isPending: false };
  });

  it("renderiza el botón de menú (tres puntos) y la acción de cancelar", async () => {
    const { getByTestId, getByText } = await renderBar();

    expect(getByTestId("actions-menu-button")).toBeTruthy();
    expect(getByTestId("actions-menu-action-cancel-shipment")).toBeTruthy();
    expect(getByText("Cancelar envío")).toBeTruthy();
  });

  it("al elegir 'Cancelar envío' del menú nativo abre el sheet de cancelación", async () => {
    const { getByTestId, queryByTestId } = await renderBar();

    expect(queryByTestId("actions-cancel-sheet-reason-input")).toBeNull();

    await pressCancelAction(getByTestId);

    expect(getByTestId("actions-cancel-sheet-no-hold")).toBeTruthy();
    expect(getByTestId("actions-cancel-sheet-reason-input")).toBeTruthy();
  });

  it("al cancelar, cierra el sheet y le pasa el mensaje de éxito a la pantalla", async () => {
    mockMutateCancel.mockResolvedValueOnce({ id: "shipment-1", status: "cancelled" });
    const onCancelled = jest.fn();
    const { getByTestId, queryByTestId } = await renderBar(onCancelled);

    await pressCancelAction(getByTestId);
    await fireEvent.press(getByTestId("actions-cancel-sheet-confirm"));

    expect(onCancelled).toHaveBeenCalledWith("Cancelaste el envío.");
    expect(queryByTestId("actions-cancel-sheet-reason-input")).toBeNull();
  });
});
