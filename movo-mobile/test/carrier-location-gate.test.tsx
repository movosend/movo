import { act, fireEvent, render } from "@testing-library/react-native";
import { CarrierLocationGate } from "../components/location/carrier-location-gate";
import type { CarrierLocationReadiness } from "../src/lib/carrier-location-readiness";
import {
  requireCarrierLocation,
  useCarrierLocationGateStore,
} from "../src/store/carrier-location-gate-store";
import { getCarrierLocationReadiness } from "../src/lib/carrier-location-readiness";

jest.mock("../src/lib/carrier-location-readiness", () => {
  const actual = jest.requireActual("../src/lib/carrier-location-readiness");
  return { ...actual, getCarrierLocationReadiness: jest.fn() };
});

jest.mock("expo-camera", () => ({ Camera: {} }));

const READY: CarrierLocationReadiness = {
  servicesEnabled: true,
  foregroundGranted: true,
  foregroundCanAskAgain: true,
  precise: true,
  backgroundGranted: true,
  backgroundCanAskAgain: true,
};
const NO_BACKGROUND = { ...READY, backgroundGranted: false };

describe("CarrierLocationGate", () => {
  it("marca lo cumplido y destaca el requisito que falta", async () => {
    const screen = await render(
      <CarrierLocationGate
        visible
        readiness={NO_BACKGROUND}
        missing="background"
        needsSettings={false}
        pending={false}
        onResolve={jest.fn()}
      />,
    );

    expect(screen.getByTestId("carrier-location-requirement-foreground-met")).toBeTruthy();
    expect(screen.getByTestId("carrier-location-requirement-precise-met")).toBeTruthy();
    expect(screen.getByTestId("carrier-location-requirement-background-missing")).toBeTruthy();
    expect(screen.getByText("Permitir en segundo plano")).toBeTruthy();
  });

  it("ofrece Ajustes cuando el SO ya no vuelve a preguntar", async () => {
    const onResolve = jest.fn();
    const screen = await render(
      <CarrierLocationGate
        visible
        readiness={NO_BACKGROUND}
        missing="background"
        needsSettings
        pending={false}
        onResolve={onResolve}
      />,
    );

    expect(screen.getByText("Abrir Ajustes")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("carrier-location-gate-action"));
    });
    expect(onResolve).toHaveBeenCalled();
  });

  it("sin onDismiss no tiene salida (viaje en curso)", async () => {
    const screen = await render(
      <CarrierLocationGate
        visible
        readiness={NO_BACKGROUND}
        missing="background"
        needsSettings={false}
        pending={false}
        onResolve={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("carrier-location-gate-dismiss")).toBeNull();
  });

  it("con onDismiss permite salir con «Ahora no»", async () => {
    const onDismiss = jest.fn();
    const screen = await render(
      <CarrierLocationGate
        visible
        readiness={NO_BACKGROUND}
        missing="background"
        needsSettings={false}
        pending={false}
        onResolve={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("carrier-location-gate-dismiss"));
    });
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("requireCarrierLocation", () => {
  const mockedReadiness = getCarrierLocationReadiness as jest.Mock;

  beforeEach(() => {
    useCarrierLocationGateStore.setState({ requested: false, pendingAction: null, onCancel: null });
  });

  it("ejecuta la acción en el momento si ya se cumple todo", async () => {
    mockedReadiness.mockResolvedValue(READY);
    const action = jest.fn();
    await requireCarrierLocation(action);
    expect(action).toHaveBeenCalled();
    expect(useCarrierLocationGateStore.getState().requested).toBe(false);
  });

  it("si falta segundo plano, no ejecuta la acción y abre el gate", async () => {
    mockedReadiness.mockResolvedValue(NO_BACKGROUND);
    const action = jest.fn();
    await requireCarrierLocation(action);
    expect(action).not.toHaveBeenCalled();
    expect(useCarrierLocationGateStore.getState().requested).toBe(true);

    // El gate la saca para ejecutarla cuando se cumplen los requisitos.
    const pending = useCarrierLocationGateStore.getState().take();
    expect(pending).toBe(action);
    expect(useCarrierLocationGateStore.getState().requested).toBe(false);
  });

  it("cancelar descarta la acción y avisa al caller", async () => {
    mockedReadiness.mockResolvedValue(NO_BACKGROUND);
    const action = jest.fn();
    const onCancel = jest.fn();
    await requireCarrierLocation(action, { onCancel });

    useCarrierLocationGateStore.getState().cancel();

    expect(onCancel).toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    expect(useCarrierLocationGateStore.getState().pendingAction).toBeNull();
  });
});
