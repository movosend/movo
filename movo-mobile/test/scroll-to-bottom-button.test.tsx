import { fireEvent, render } from "@testing-library/react-native";
import { ScrollToBottomButton } from "../components/chat/scroll-to-bottom-button";

describe("ScrollToBottomButton (MOVO-301)", () => {
  afterEach(() => {
    (globalThis as { __reduceMotion?: boolean }).__reduceMotion = false;
  });

  it("no renderiza nada si no es visible", async () => {
    const { queryByTestId } = await render(<ScrollToBottomButton visible={false} newCount={0} onPress={jest.fn()} />);
    expect(queryByTestId("chat-scroll-bottom")).toBeNull();
  });

  it("muestra el contador de nuevos y lo anuncia en la etiqueta de accesibilidad", async () => {
    const onPress = jest.fn();
    const { getByTestId, queryByTestId } = await render(<ScrollToBottomButton visible newCount={0} onPress={onPress} />);
    expect(getByTestId("chat-scroll-bottom-btn").props.accessibilityLabel).toBe("Ir al último mensaje");
    expect(queryByTestId("chat-scroll-bottom-badge")).toBeNull();
    await fireEvent.press(getByTestId("chat-scroll-bottom-btn"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("con 'Reducir movimiento' se muestra igual, sin animación de entrada", async () => {
    (globalThis as { __reduceMotion?: boolean }).__reduceMotion = true;
    const { getByTestId } = await render(<ScrollToBottomButton visible newCount={3} onPress={jest.fn()} />);
    expect(getByTestId("chat-scroll-bottom-badge")).toHaveTextContent("3");
  });
});
