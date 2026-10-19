import { fireEvent, render } from "@testing-library/react-native";
import { CarrierActionsBar } from "../components/shipments/carrier-actions-bar";

jest.mock("../src/hooks/use-shipments", () => ({
  useCarrierWithdrawalQuote: () => ({
    mutateAsync: jest.fn().mockResolvedValue({ penaltyArs: 0, reason: "before_free_deadline", freeUntil: null }),
  }),
  useCarrierWithdraw: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// El menú nativo no tiene representación en el árbol de React: cada acción es una fila tocable.
jest.mock("@react-native-menu/menu", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    MenuView: ({ testID, actions, onPressAction, children }: any) => (
      <View testID={testID}>
        {children}
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

describe("CarrierActionsBar (MOVO-314)", () => {
  it("ofrece 'No puedo hacer este envío' como acción destructiva", async () => {
    const { getByText, getByTestId } = await render(
      <CarrierActionsBar shipmentId="shipment-1" onWithdrawn={jest.fn()} testID="actions" />,
    );

    expect(getByTestId("actions-menu-button")).toBeTruthy();
    expect(getByText("No puedo hacer este envío")).toBeTruthy();
  });

  it("elegirla abre el sheet de cotización", async () => {
    const { getByTestId, findByTestId, queryByTestId } = await render(
      <CarrierActionsBar shipmentId="shipment-1" onWithdrawn={jest.fn()} testID="actions" />,
    );
    expect(queryByTestId("actions-sheet-confirm")).toBeNull();

    await fireEvent.press(getByTestId("actions-menu-action-withdraw-shipment"));

    expect(await findByTestId("actions-sheet-confirm")).toBeTruthy();
  });
});
