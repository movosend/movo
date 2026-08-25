import { act, render } from "@testing-library/react-native";
import { SuccessBanner } from "../components/ui/success-banner";

describe("SuccessBanner (MOVO-135 AC2)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("no renderiza nada sin mensaje, así se puede montar siempre", async () => {
    const { queryByTestId } = await render(
      <SuccessBanner testID="success" message={null} />,
    );
    expect(queryByTestId("success")).toBeNull();
  });

  it("muestra el mensaje de éxito", async () => {
    const { getByTestId, getByText } = await render(
      <SuccessBanner testID="success" message="Guardamos tus cambios." />,
    );
    expect(getByTestId("success")).toBeTruthy();
    expect(getByText("Guardamos tus cambios.")).toBeTruthy();
  });

  // A diferencia de `ErrorBanner`, que es persistente a propósito: una confirmación
  // que se queda fija termina leyéndose como estado permanente de la pantalla.
  it("se auto-oculta avisando al caller", async () => {
    const onDismiss = jest.fn();
    await render(
      <SuccessBanner testID="success" message="Listo." onDismiss={onDismiss} />,
    );

    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("no se auto-oculta con autoDismissMs en 0", async () => {
    const onDismiss = jest.fn();
    await render(
      <SuccessBanner
        testID="success"
        message="Listo."
        onDismiss={onDismiss}
        autoDismissMs={0}
      />,
    );
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
