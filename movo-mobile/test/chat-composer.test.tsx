import { fireEvent, render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { ChatComposer } from "../components/chat/chat-composer";

jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));

describe("ChatComposer (MOVO-284)", () => {
  const props = { readOnlyCopy: "El envío finalizó.", testID: "c" };

  it("envía el texto sin espacios y vacía el campo", async () => {
    const onSend = jest.fn(() => true);
    const { getByTestId } = await render(<ChatComposer {...props} canWrite onSend={onSend} />);

    await fireEvent.changeText(getByTestId("c-input"), "  Hola  ");
    await fireEvent.press(getByTestId("c-send"));

    expect(onSend).toHaveBeenCalledWith("Hola");
    expect(getByTestId("c-input").props.value).toBe("");
  });

  it("MOVO-301: al enviar vibra suave; si no se pudo enviar, no", async () => {
    (Haptics.impactAsync as jest.Mock).mockClear();
    const sent = await render(<ChatComposer {...props} canWrite onSend={jest.fn(() => true)} />);
    await fireEvent.changeText(sent.getByTestId("c-input"), "Hola");
    await fireEvent.press(sent.getByTestId("c-send"));
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    sent.unmount();

    (Haptics.impactAsync as jest.Mock).mockClear();
    const failed = await render(<ChatComposer {...props} canWrite onSend={jest.fn(() => false)} />);
    await fireEvent.changeText(failed.getByTestId("c-input"), "Hola");
    await fireEvent.press(failed.getByTestId("c-send"));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("no envía un texto vacío", async () => {
    const onSend = jest.fn(() => true);
    const { getByTestId } = await render(<ChatComposer {...props} canWrite onSend={onSend} />);

    await fireEvent.changeText(getByTestId("c-input"), "   ");
    await fireEvent.press(getByTestId("c-send"));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("si no se pudo enviar conserva lo escrito", async () => {
    const onSend = jest.fn(() => false);
    const { getByTestId } = await render(<ChatComposer {...props} canWrite onSend={onSend} />);

    await fireEvent.changeText(getByTestId("c-input"), "Hola");
    await fireEvent.press(getByTestId("c-send"));

    expect(getByTestId("c-input").props.value).toBe("Hola");
  });

  it("el contador aparece cerca del límite y no deja enviar pasado de 1000", async () => {
    const onSend = jest.fn(() => true);
    const { getByTestId, queryByTestId } = await render(<ChatComposer {...props} canWrite onSend={onSend} />);

    await fireEvent.changeText(getByTestId("c-input"), "a".repeat(100));
    expect(queryByTestId("c-counter")).toBeNull();

    await fireEvent.changeText(getByTestId("c-input"), "a".repeat(850));
    expect(getByTestId("c-counter")).toHaveTextContent("850/1000");

    await fireEvent.changeText(getByTestId("c-input"), "a".repeat(1020));
    await fireEvent.press(getByTestId("c-send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("en solo lectura muestra el motivo en vez del campo", async () => {
    const { getByTestId, getByText, queryByTestId } = await render(<ChatComposer {...props} canWrite={false} onSend={jest.fn()} />);

    expect(getByTestId("c-readonly")).toBeTruthy();
    expect(getByText("El envío finalizó.")).toBeTruthy();
    expect(queryByTestId("c-input")).toBeNull();
  });
});
