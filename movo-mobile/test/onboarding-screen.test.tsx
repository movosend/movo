import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import OnboardingScreen from "../app/onboarding";

const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
}));

jest.mock("../src/lib/onboarding-storage", () => ({
  markOnboardingSeen: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
}));
jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
}));
jest.mock("expo-camera", () => ({
  Camera: {
    requestCameraPermissionsAsync: jest
      .fn()
      .mockResolvedValue({ granted: true, canAskAgain: true }),
    getCameraPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  },
}));

/**
 * Estos tests cubren la navegación/wiring de la pantalla (qué se ve en cada paso, qué
 * dispara cada botón). El avance automático post-permiso (`ADVANCE_DELAY_MS`, ~350ms)
 * ya está cubierto a fondo en `use-onboarding-flow.test.ts` con timers falsos — acá no
 * se espera ese avance para no acoplar este test a timers reales/falsos entrando en
 * conflicto con las animaciones de las ilustraciones (Reanimated).
 */
describe("OnboardingScreen (MOVO-249)", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.useRealTimers());

  /** Timers falsos solo en los tests que necesitan cruzar `ADVANCE_DELAY_MS` — a
   * nivel de `beforeEach` chocan con las animaciones (Reanimated) de las
   * ilustraciones de los pasos de concepto y cuelgan el render. */
  const withFakeTimers = () => jest.useFakeTimers();

  it("arranca en el primer paso de concepto, con 'Omitir' pero sin volver", async () => {
    await render(<OnboardingScreen />);

    expect(screen.getByText(/Enviá algo a cualquier lado/)).toBeTruthy();
    expect(screen.getByTestId("onboarding-skip")).toBeTruthy();
    expect(screen.queryByTestId("onboarding-back")).toBeNull();
  });

  it("'Siguiente' avanza de 'La red' a 'Confianza', y 'Atrás' vuelve", async () => {
    await render(<OnboardingScreen />);

    await act(async () => fireEvent.press(screen.getByTestId("onboarding-next")));
    expect(screen.getByText(/Confiá en un desconocido/)).toBeTruthy();
    expect(screen.getByTestId("onboarding-back")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId("onboarding-back")));
    expect(screen.getByText(/Enviá algo a cualquier lado/)).toBeTruthy();
  });

  it("'Omitir' desde 'La red' salta directo al paso de Ubicación (sin pasar por Confianza)", async () => {
    await render(<OnboardingScreen />);

    await act(async () => fireEvent.press(screen.getByTestId("onboarding-skip")));

    expect(screen.getByText(/Seguí tu envío en tiempo real/)).toBeTruthy();
    expect(screen.queryByTestId("onboarding-skip")).toBeNull();
    expect(screen.getByTestId("onboarding-back")).toBeTruthy();
  });

  it("en el paso de ubicación, 'Activar ubicación' pide el permiso real del SO", async () => {
    const Location = require("expo-location");
    await render(<OnboardingScreen />);
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-skip")));

    await act(async () => fireEvent.press(screen.getByTestId("onboarding-permission-primary")));

    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  // Ubicación y cámara son obligatorias (ver `src/lib/required-permissions.ts`): esos
  // pasos no ofrecen ninguna salida, a diferencia del de notificaciones.
  it("el paso de ubicación no ofrece 'Ahora no'", async () => {
    await render(<OnboardingScreen />);
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-skip")));

    expect(screen.queryByTestId("onboarding-permission-later")).toBeNull();
  });

  it("el paso de notificaciones sí ofrece 'Ahora no', y no pide ningún permiso", async () => {
    withFakeTimers();
    const Notifications = require("expo-notifications");
    await render(<OnboardingScreen />);
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-skip")));
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-permission-primary")));
    await act(async () => jest.advanceTimersByTime(400));

    expect(screen.getByText(/Enterate de cada paso del envío/)).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-permission-later")));

    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("ubicación denegada muestra el aviso de obligatoriedad y no avanza", async () => {
    const Location = require("expo-location");
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    });
    await render(<OnboardingScreen />);
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-skip")));

    await act(async () => fireEvent.press(screen.getByTestId("onboarding-permission-primary")));

    expect(screen.getByTestId("onboarding-permission-warning")).toBeTruthy();
    expect(screen.getByText(/no podés usar Movo/)).toBeTruthy();
    expect(screen.getByText(/Seguí tu envío en tiempo real/)).toBeTruthy();
  });

  it("ubicación denegada de forma permanente ofrece abrir Ajustes en vez de reintentar", async () => {
    const Location = require("expo-location");
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });
    await render(<OnboardingScreen />);
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-skip")));

    await act(async () => fireEvent.press(screen.getByTestId("onboarding-permission-primary")));

    expect(screen.getByText("Abrir Ajustes")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("onboarding-permission-primary")));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
});
