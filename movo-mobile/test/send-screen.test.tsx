import { act, fireEvent, render } from "@testing-library/react-native";
import { Alert } from "react-native";
import { router } from "expo-router";
import SendShipmentScreen from "../app/(app)/send";
import { useShipmentWizardStore } from "../src/store/shipment-wizard-store";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn() },
}));

jest.mock("../src/hooks/use-addresses", () => ({
  useAddresses: () => ({ data: undefined }),
  useCreateAddress: () => ({ mutate: jest.fn() }),
}));

/** Zustand con `useSyncExternalStore` (React 19) necesita el microtask flush de un
 * `act(async () => ...)` para reflejarse en el árbol de RTL — un `act` sync no alcanza. */
async function setStoreState(mutate: () => void) {
  await act(async () => {
    mutate();
    await Promise.resolve();
  });
}

// MOVO-83: shell del wizard real (reemplaza el placeholder). Cubre la navegación
// entre pasos, el gating por validez de cada paso, y el diálogo de abandono desde el
// paso 0 — el detalle de cada paso se testea en sus propios archivos.
describe("SendShipmentScreen", () => {
  beforeEach(() => {
    useShipmentWizardStore.getState().resetWizard();
    jest.clearAllMocks();
  });

  it("arranca en el paso de paquete con 'Siguiente' deshabilitado hasta completar los campos", async () => {
    const { getByText, getByTestId } = await render(<SendShipmentScreen />);

    expect(getByText("¿Qué vas a enviar?")).toBeTruthy();
    expect(getByTestId("send-wizard-next").props.accessibilityState?.disabled).toBe(true);
  });

  it("avanza al paso de receptor cuando el paso de paquete queda completo", async () => {
    const { getByText, getByTestId } = await render(<SendShipmentScreen />);

    await setStoreState(() => {
      const store = useShipmentWizardStore.getState();
      store.setPackageType("standard_package");
      store.setWeightKg("1.5");
      store.setLengthCm("30");
      store.setWidthCm("20");
      store.setHeightCm("15");
    });

    expect(getByTestId("send-wizard-next").props.accessibilityState?.disabled).toBeFalsy();
    await act(async () => {
      fireEvent.press(getByTestId("send-wizard-next"));
      await Promise.resolve();
    });

    expect(getByText("¿Quién lo recibe?")).toBeTruthy();
  });

  it("pide confirmación al tocar el back button en el paso 0", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { getByTestId } = await render(<SendShipmentScreen />);

    fireEvent.press(getByTestId("send-wizard-back"));

    expect(alertSpy).toHaveBeenCalledWith(
      "¿Descartar este envío?",
      expect.any(String),
      expect.any(Array),
    );
  });

  it("vuelve un paso (sin confirmar) al tocar back desde un paso posterior al 0", async () => {
    const { getByTestId, getByText } = await render(<SendShipmentScreen />);

    await setStoreState(() => useShipmentWizardStore.getState().setStep(2));
    expect(getByText("¿De dónde a dónde?")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("send-wizard-back"));
      await Promise.resolve();
    });

    expect(getByText("¿Quién lo recibe?")).toBeTruthy();
  });
});
