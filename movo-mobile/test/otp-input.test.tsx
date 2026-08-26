import { act, fireEvent, render } from "@testing-library/react-native";
import { useState } from "react";
import { OtpInput } from "../components/ui/otp-input";

/** Wrapper controlado: `OtpInput` es presentacional puro, el valor vive afuera. */
function Harness({ onComplete }: { onComplete?: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <OtpInput value={code} onChange={setCode} onComplete={onComplete} testIDPrefix="otp" />
  );
}

async function type(getByTestId: (id: string) => unknown, index: number, value: string) {
  await act(async () => {
    fireEvent.changeText(getByTestId(`otp-${index}`) as never, value);
    await Promise.resolve();
  });
}

describe("OtpInput", () => {
  it("reparte entre las casillas el código completo que entrega el autofill de iOS", async () => {
    const onComplete = jest.fn();
    const { getByTestId } = await render(<Harness onComplete={onComplete} />);

    // iOS puede entregar los 6 dígitos de un tirón a la casilla que tenía el foco —
    // por eso las casillas no llevan `maxLength`.
    await type(getByTestId, 0, "123456");

    expect(getByTestId("otp-0").props.value).toBe("1");
    expect(getByTestId("otp-5").props.value).toBe("6");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("avanza casilla a casilla y avisa recién cuando se completa el código", async () => {
    const onComplete = jest.fn();
    const { getByTestId } = await render(<Harness onComplete={onComplete} />);

    for (const [index, digit] of [..."12345"].entries()) {
      await type(getByTestId, index, digit);
    }
    expect(onComplete).not.toHaveBeenCalled();

    await type(getByTestId, 5, "6");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("descarta lo que no sea dígito", async () => {
    const { getByTestId } = await render(<Harness />);
    await type(getByTestId, 0, "a");
    expect(getByTestId("otp-0").props.value).toBe("");
  });

  it("no rompe con backspace sobre una casilla ya vacía", async () => {
    const { getByTestId } = await render(<Harness />);
    expect(() =>
      fireEvent(getByTestId("otp-2"), "keyPress", { nativeEvent: { key: "Backspace" } }),
    ).not.toThrow();
  });

  it("bloquea la escritura cuando no es editable", async () => {
    const { getByTestId } = await render(
      <OtpInput value="" onChange={jest.fn()} editable={false} testIDPrefix="otp" />,
    );
    expect(getByTestId("otp-0").props.editable).toBe(false);
  });

  it("usa sms-otp en la primera casilla por defecto (registro, cambio de teléfono/email)", async () => {
    const { getByTestId } = await render(<Harness />);
    expect(getByTestId("otp-0").props.autoComplete).toBe("sms-otp");
    expect(getByTestId("otp-1").props.autoComplete).toBe("off");
  });

  it("MOVO-141: permite desactivar el autofill de SMS en la primera casilla (canal email)", async () => {
    const { getByTestId } = await render(
      <OtpInput value="" onChange={jest.fn()} testIDPrefix="otp" firstBoxAutoComplete="off" />,
    );
    expect(getByTestId("otp-0").props.autoComplete).toBe("off");
  });
});
