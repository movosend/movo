import { fireEvent, render } from "@testing-library/react-native";
import { ChatComposer } from "../components/chat/chat-composer";

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

  it("MOVO-324: acepta otro largo máximo (soporte, 2000) y el contador lo sigue", async () => {
    const onSend = jest.fn(() => true);
    const { getByTestId } = await render(<ChatComposer {...props} canWrite onSend={onSend} maxLength={2000} />);

    await fireEvent.changeText(getByTestId("c-input"), "a".repeat(1500));
    await fireEvent.press(getByTestId("c-send"));
    expect(onSend).toHaveBeenCalledTimes(1);

    await fireEvent.changeText(getByTestId("c-input"), "a".repeat(1700));
    expect(getByTestId("c-counter")).toHaveTextContent("1700/2000");
  });

  it("MOVO-324: con fotos listas deja enviar sin texto; con una foto pendiente no deja enviar", async () => {
    const onSend = jest.fn(() => true);
    const view = await render(<ChatComposer {...props} canWrite onSend={onSend} allowEmpty />);
    await fireEvent.press(view.getByTestId("c-send"));
    expect(onSend).toHaveBeenCalledWith("");

    onSend.mockClear();
    await view.rerender(<ChatComposer {...props} canWrite onSend={onSend} allowEmpty sendDisabled />);
    await fireEvent.changeText(view.getByTestId("c-input"), "Hola");
    await fireEvent.press(view.getByTestId("c-send"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("MOVO-324: dibuja la acción de la izquierda y las miniaturas pendientes", async () => {
    const { Text } = require("react-native");
    const { getByText } = await render(
      <ChatComposer {...props} canWrite onSend={jest.fn()} leftAction={<Text>adjuntar</Text>} attachmentsSlot={<Text>miniaturas</Text>} />,
    );
    expect(getByText("adjuntar")).toBeTruthy();
    expect(getByText("miniaturas")).toBeTruthy();
  });
});
