import { fireEvent, render } from "@testing-library/react-native";
import { AcceptSuccessModal } from "../components/shipments/accept-success-modal";

describe("AcceptSuccessModal", () => {
  it("renderiza la confirmación animada y llama a onDismiss al presionar 'Ver detalle'", async () => {
    const onDismiss = jest.fn();
    const { getByTestId, getByText } = await render(
      <AcceptSuccessModal visible={true} onDismiss={onDismiss} testID="success-modal" />,
    );

    expect(getByTestId("success-modal")).toBeTruthy();
    expect(getByText("Envío aceptado")).toBeTruthy();
    expect(
      getByText(
        "Confirmaste que esperás este paquete. El emisor fue notificado y el envío ya está publicado para transportistas.",
      ),
    ).toBeTruthy();

    await fireEvent.press(getByTestId("success-modal-view-button"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
