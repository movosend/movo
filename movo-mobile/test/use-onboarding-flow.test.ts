import { act, renderHook } from "@testing-library/react-native";
import { useOnboardingFlow } from "../src/hooks/use-onboarding-flow";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockMarkOnboardingSeen = jest.fn().mockResolvedValue(undefined);
jest.mock("../src/lib/onboarding-storage", () => ({
  markOnboardingSeen: () => mockMarkOnboardingSeen(),
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
}));
jest.mock("expo-notifications", () => ({
  requestPermissionsAsync: jest.fn(),
}));
jest.mock("expo-camera", () => ({
  Camera: {
    requestCameraPermissionsAsync: jest.fn(),
    getCameraPermissionsAsync: jest.fn(),
  },
}));

import { Camera } from "expo-camera";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { AppState, Linking } from "react-native";

const granted = { granted: true, canAskAgain: true };
const denied = { granted: false, canAskAgain: true };
const blocked = { granted: false, canAskAgain: false };

describe("useOnboardingFlow", () => {
  /** Handler de `AppState` registrado por el hook — permite simular la vuelta a
   * foreground (p. ej. al volver de Ajustes) sin depender del ciclo real de la app. */
  let appStateHandler: ((state: string) => void) | null = null;
  let openSettingsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    appStateHandler = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, handler) => {
      appStateHandler = handler as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
    openSettingsSpy = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** Lleva el flujo hasta el paso de ubicación (2), el primero de permisos. */
  async function atLocationStep() {
    const { result } = await renderHook(() => useOnboardingFlow());
    await act(async () => result.current.skipIntro());
    return result;
  }

  it("arranca en el paso 0, sin back ni progreso oculto, con skip visible", async () => {
    const { result } = await renderHook(() => useOnboardingFlow());

    expect(result.current.step).toBe(0);
    expect(result.current.showBack).toBe(false);
    expect(result.current.showSkip).toBe(true);
    expect(result.current.showProgress).toBe(true);
    expect(result.current.isDarkStep).toBe(false);
  });

  it("next() avanza paso a paso, back() retrocede, sin salir de [0,5]", async () => {
    const { result } = await renderHook(() => useOnboardingFlow());

    await act(async () => result.current.next());
    expect(result.current.step).toBe(1);

    await act(async () => result.current.back());
    expect(result.current.step).toBe(0);

    // back() en el paso 0 no debería mandar a -1.
    await act(async () => result.current.back());
    expect(result.current.step).toBe(0);
  });

  it("skipIntro() salta directo al paso 2 (permisos), sin pasar por 'Confianza'", async () => {
    const { result } = await renderHook(() => useOnboardingFlow());

    await act(async () => result.current.skipIntro());

    expect(result.current.step).toBe(2);
    expect(result.current.isDarkStep).toBe(true);
    expect(result.current.showSkip).toBe(false);
  });

  it("requestLocation() concedido registra 'granted' y avanza de paso tras el delay", async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(granted);
    const result = await atLocationStep();

    await act(async () => {
      await result.current.requestLocation();
    });
    expect(result.current.permissions.location).toBe("granted");

    await act(async () => jest.advanceTimersByTime(400));
    expect(result.current.step).toBe(3);
    expect(result.current.pendingPermission).toBeNull();
  });

  // Obligatoriedad de ubicación/cámara: el corazón de este comportamiento.
  it("requestLocation() denegado NO avanza — la ubicación es obligatoria", async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(denied);
    const result = await atLocationStep();

    await act(async () => {
      await result.current.requestLocation();
    });
    await act(async () => jest.advanceTimersByTime(400));

    expect(result.current.permissions.location).toBe("denied");
    expect(result.current.step).toBe(2);
    expect(result.current.pendingPermission).toBeNull();
  });

  it("requestLocation() denegado de forma permanente registra 'blocked' y tampoco avanza", async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(blocked);
    const result = await atLocationStep();

    await act(async () => {
      await result.current.requestLocation();
    });
    await act(async () => jest.advanceTimersByTime(400));

    expect(result.current.permissions.location).toBe("blocked");
    expect(result.current.step).toBe(2);
  });

  it("requestCamera() denegado NO avanza al paso final — la cámara es obligatoria", async () => {
    (Camera.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue(denied);
    const result = await atLocationStep();
    await act(async () => {
      result.current.next();
      result.current.next();
    }); // paso 4 (cámara)

    await act(async () => {
      await result.current.requestCamera();
    });
    await act(async () => jest.advanceTimersByTime(400));

    expect(result.current.permissions.camera).toBe("denied");
    expect(result.current.step).toBe(4);
  });

  it("skipPermission() es un no-op sobre un permiso obligatorio (no marca ni avanza)", async () => {
    const result = await atLocationStep();

    await act(async () => result.current.skipPermission("location"));
    await act(async () => jest.advanceTimersByTime(400));

    expect(result.current.permissions.location).toBeUndefined();
    expect(result.current.step).toBe(2);
  });

  it("volver de Ajustes con el permiso ya concedido destraba el paso bloqueado", async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(blocked);
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue(granted);
    const result = await atLocationStep();

    await act(async () => {
      await result.current.requestLocation();
    });
    expect(result.current.permissions.location).toBe("blocked");

    // Simula la vuelta a foreground tras activar el permiso en Ajustes.
    await act(async () => {
      appStateHandler?.("active");
    });
    await act(async () => jest.advanceTimersByTime(400));

    expect(result.current.permissions.location).toBe("granted");
    expect(result.current.step).toBe(3);
  });

  it("openSettings() abre la ficha de la app en el SO", async () => {
    const result = await atLocationStep();

    await act(async () => result.current.openSettings());

    expect(openSettingsSpy).toHaveBeenCalledTimes(1);
  });

  // Notificaciones sigue siendo el único permiso opcional del carrusel.
  it("requestNotifications() denegado igual avanza (no es obligatorio)", async () => {
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: "denied" });
    const result = await atLocationStep();
    await act(async () => result.current.next()); // paso 3

    await act(async () => {
      await result.current.requestNotifications();
    });
    await act(async () => jest.advanceTimersByTime(400));

    expect(result.current.permissions.notifications).toBe("denied");
    expect(result.current.step).toBe(4);
  });

  it("un permiso opcional que tira (excepción) se trata como denegado, sin romper el flujo", async () => {
    (Notifications.requestPermissionsAsync as jest.Mock).mockRejectedValue(new Error("boom"));
    const result = await atLocationStep();
    await act(async () => result.current.next()); // paso 3

    await act(async () => {
      await result.current.requestNotifications();
    });
    await act(async () => jest.advanceTimersByTime(400));

    expect(result.current.permissions.notifications).toBe("denied");
    expect(result.current.step).toBe(4);
  });

  it("skipPermission('notifications') marca 'later' y avanza sin pedir el permiso real", async () => {
    const result = await atLocationStep();
    await act(async () => result.current.next()); // paso 3

    await act(async () => result.current.skipPermission("notifications"));
    expect(result.current.permissions.notifications).toBe("later");
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(400));
    expect(result.current.step).toBe(4);
  });

  it("finish() marca el onboarding como visto y navega a '/'", async () => {
    const { result } = await renderHook(() => useOnboardingFlow());

    await act(async () => {
      await result.current.finish();
    });

    expect(mockMarkOnboardingSeen).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
