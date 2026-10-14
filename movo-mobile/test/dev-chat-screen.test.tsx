import { fireEvent, render } from "@testing-library/react-native";
import DevChatScreen from "../components/dev/DevChatScreen";

jest.mock("expo-router", () => ({ router: { back: jest.fn() } }));

describe("DevChatScreen (galería, solo dev)", () => {
  it("muestra la conversación de ejemplo y la lista de chats", async () => {
    const { getByText, getByTestId } = await render(<DevChatScreen />);

    expect(getByText("Emisor, transportista y receptor")).toBeTruthy();
    expect(getByText("Dale, te escribo al llegar.")).toBeTruthy();
    expect(getByTestId("dev-chat-row-a-02841")).toBeTruthy();
  });

  it("cambia de escenario: recién creada y solo lectura", async () => {
    const { getByTestId, queryByTestId } = await render(<DevChatScreen />);

    await fireEvent.press(getByTestId("dev-chat-scenario-empty"));
    expect(getByTestId("dev-chat-empty")).toBeTruthy();

    await fireEvent.press(getByTestId("dev-chat-scenario-readonly"));
    expect(getByTestId("dev-chat-composer-readonly")).toBeTruthy();
    expect(queryByTestId("dev-chat-composer-input")).toBeNull();
  });

  it("una respuesta rápida se suma a la conversación", async () => {
    const { getByTestId, getAllByText } = await render(<DevChatScreen />);

    await fireEvent.press(getByTestId("dev-chat-quick-Te espero en la puerta"));
    expect(getAllByText("Te espero en la puerta").length).toBeGreaterThan(1);
  });

  it("simula la llegada y la entrega, y el texto cambia según el rol", async () => {
    const { getByTestId, getByText } = await render(<DevChatScreen />);

    await fireEvent.press(getByTestId("dev-chat-advance"));
    expect(getByText("Diego está llegando al destino")).toBeTruthy();

    await fireEvent.press(getByTestId("dev-chat-role-carrier"));
    expect(getByText("Estás llegando al destino")).toBeTruthy();
    expect(getByText("Aceptaste el envío")).toBeTruthy();
  });

  it("simula un mensaje en vivo y la advertencia de lenguaje", async () => {
    const { getByTestId, getByText } = await render(<DevChatScreen />);

    await fireEvent.press(getByTestId("dev-chat-incoming"));
    expect(getByText("Mensaje nuevo que llegó en vivo")).toBeTruthy();

    await fireEvent.press(getByTestId("dev-chat-warning"));
    expect(getByTestId("chat-moderation-banner")).toBeTruthy();
  });
});
