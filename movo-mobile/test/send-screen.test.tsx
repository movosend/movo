import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import SendShipmentScreen from "../app/(app)/send";

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
}));

// MOVO-83: punto de entrada real al wizard (placeholder hasta que el ticket del
// wizard en sí arranque) — solo verifica que la navegación de vuelta funcione.
describe("SendShipmentScreen", () => {
  it("vuelve a la pantalla anterior al tocar 'Volver a Inicio'", async () => {
    const { getByTestId } = await render(<SendShipmentScreen />);

    fireEvent.press(getByTestId("send-screen-back"));

    expect(router.back).toHaveBeenCalled();
  });
});
