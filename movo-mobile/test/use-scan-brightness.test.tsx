import React from "react";
import { AppState, Platform, Text } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import * as Brightness from "expo-brightness";
import { useScanBrightness } from "../src/hooks/use-scan-brightness";

function Harness() {
  useScanBrightness();
  return <Text>qr</Text>;
}

describe("useScanBrightness", () => {
  let appStateListener: ((state: string) => void) | undefined;
  const remove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { OS: string }).OS = "ios";
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  it("sube el brillo al máximo al montar y repone el valor previo al desmontar (iOS)", async () => {
    const { unmount } = await render(<Harness />);

    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1));

    await act(async () => {
      unmount();
    });

    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4));
    expect(remove).toHaveBeenCalled();
  });

  it("en Android restaura el brillo del sistema en vez de reponer un valor a mano", async () => {
    (Platform as { OS: string }).OS = "android";
    const { unmount } = await render(<Harness />);
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1));

    await act(async () => {
      unmount();
    });

    await waitFor(() => expect(Brightness.restoreSystemBrightnessAsync).toHaveBeenCalled());
  });

  it("repone el brillo al pasar a background y lo vuelve a subir al volver", async () => {
    await render(<Harness />);
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1));

    await act(async () => {
      appStateListener?.("background");
    });
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4));

    await act(async () => {
      appStateListener?.("active");
    });
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(1));
  });

  it("repone el brillo también en inactive (centro de control, llamada entrante)", async () => {
    await render(<Harness />);
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1));

    await act(async () => {
      appStateListener?.("inactive");
    });
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4));
  });

  it("si se desmonta con la subida de brillo en vuelo, la restauración corre después", async () => {
    let resolveRaise: () => void = () => {};
    (Brightness.setBrightnessAsync as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveRaise = resolve)),
    );
    const { unmount } = await render(<Harness />);
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1));

    await act(async () => {
      unmount();
    });
    // Mientras la subida no terminó, la restauración todavía no se pidió.
    expect(Brightness.setBrightnessAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRaise();
    });
    await waitFor(() => expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4));
  });

  it("no rompe si el módulo nativo falla", async () => {
    (Brightness.getBrightnessAsync as jest.Mock).mockRejectedValueOnce(new Error("no native"));
    const { getByText } = await render(<Harness />);
    expect(getByText("qr")).toBeTruthy();
  });
});
