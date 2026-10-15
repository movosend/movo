import { fireEvent, render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { ChatComposer } from "../components/chat/chat-composer";

jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));

// En un archivo aparte: un `press` async deja el entorno de `act` roto para los tests que corren después en el mismo módulo.
describe("ChatComposer — vibración al enviar (MOVO-301)", () => {
  const props = { readOnlyCopy: "El envío finalizó.", testID: "c" };
  beforeEach(() => (Haptics.impactAsync as jest.Mock).mockClear());

  it("vibra suave al enviar", async () => {
    const { getByTestId } = await render(<ChatComposer {...props} canWrite onSend={jest.fn(() => true)} />);
    await fireEvent.changeText(getByTestId("c-input"), "Hola");
    await fireEvent.press(getByTestId("c-send"));
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });
});
