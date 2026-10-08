import * as Location from "expo-location";
import { Linking, Platform } from "react-native";
import {
  firstMissingRequirement,
  getCarrierLocationReadiness,
  isPreciseLocation,
  requirementNeedsSettings,
  resolveCarrierLocationRequirement,
  type CarrierLocationReadiness,
} from "../src/lib/carrier-location-readiness";

jest.mock("expo-location", () => ({
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
}));

// `required-permissions.ts` (de donde sale `openAppSettings`) importa expo-camera.
jest.mock("expo-camera", () => ({ Camera: {} }));

const mocked = Location as jest.Mocked<typeof Location>;

const READY: CarrierLocationReadiness = {
  servicesEnabled: true,
  foregroundGranted: true,
  foregroundCanAskAgain: true,
  precise: true,
  backgroundGranted: true,
  backgroundCanAskAgain: true,
};

function permission(overrides: Record<string, unknown>) {
  return { granted: true, canAskAgain: true, status: "granted", expires: "never", ...overrides } as never;
}

const originalOS = Platform.OS;
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

afterEach(() => {
  jest.clearAllMocks();
  setPlatform(originalOS as "ios" | "android");
});

describe("isPreciseLocation", () => {
  it("iOS con «Ubicación exacta» apagada no es precisa", () => {
    expect(isPreciseLocation(permission({ ios: { scope: "whenInUse", accuracy: "reduced" } }))).toBe(false);
    expect(isPreciseLocation(permission({ ios: { scope: "always", accuracy: "full" } }))).toBe(true);
  });

  it("Android con ubicación aproximada no es precisa", () => {
    expect(isPreciseLocation(permission({ android: { accuracy: "coarse" } }))).toBe(false);
    expect(isPreciseLocation(permission({ android: { accuracy: "fine" } }))).toBe(true);
  });

  it("sin dato de plataforma se asume precisa", () => {
    expect(isPreciseLocation(permission({}))).toBe(true);
  });
});

describe("getCarrierLocationReadiness", () => {
  it("combina GPS, primer plano, precisión y segundo plano", async () => {
    mocked.hasServicesEnabledAsync.mockResolvedValue(true);
    mocked.getForegroundPermissionsAsync.mockResolvedValue(
      permission({ android: { accuracy: "fine" } }),
    );
    mocked.getBackgroundPermissionsAsync.mockResolvedValue(
      permission({ granted: false, canAskAgain: false }),
    );

    await expect(getCarrierLocationReadiness()).resolves.toEqual({
      servicesEnabled: true,
      foregroundGranted: true,
      foregroundCanAskAgain: true,
      precise: true,
      backgroundGranted: false,
      backgroundCanAskAgain: false,
    });
  });

  it("un fallo al leer nunca se trata como concedido", async () => {
    mocked.hasServicesEnabledAsync.mockRejectedValue(new Error("native"));
    const readiness = await getCarrierLocationReadiness();
    expect(firstMissingRequirement(readiness)).toBe("services");
  });
});

describe("firstMissingRequirement", () => {
  it("devuelve null cuando se cumple todo", () => {
    expect(firstMissingRequirement(READY)).toBeNull();
  });

  it("respeta el orden GPS → primer plano → precisa → segundo plano", () => {
    expect(firstMissingRequirement({ ...READY, servicesEnabled: false, backgroundGranted: false })).toBe("services");
    expect(firstMissingRequirement({ ...READY, foregroundGranted: false, precise: false })).toBe("foreground");
    expect(firstMissingRequirement({ ...READY, precise: false, backgroundGranted: false })).toBe("precise");
    expect(firstMissingRequirement({ ...READY, backgroundGranted: false })).toBe("background");
  });
});

describe("requirementNeedsSettings", () => {
  it("segundo plano va a Ajustes solo si el SO ya no puede preguntar", () => {
    expect(requirementNeedsSettings({ ...READY, backgroundGranted: false }, "background", false)).toBe(false);
    expect(
      requirementNeedsSettings(
        { ...READY, backgroundGranted: false, backgroundCanAskAgain: false },
        "background",
        false,
      ),
    ).toBe(true);
  });

  it("en iOS, segundo plano ya pedido en esta sesión que sigue faltando va a Ajustes", () => {
    setPlatform("ios");
    expect(requirementNeedsSettings({ ...READY, backgroundGranted: false }, "background", true)).toBe(true);
  });

  it("fuera de ese caso, un intento previo no manda a Ajustes si el SO puede volver a preguntar", () => {
    setPlatform("android");
    expect(requirementNeedsSettings({ ...READY, backgroundGranted: false }, "background", true)).toBe(false);
    expect(requirementNeedsSettings({ ...READY, servicesEnabled: false }, "services", true)).toBe(false);
    expect(requirementNeedsSettings({ ...READY, foregroundGranted: false }, "foreground", true)).toBe(false);
    expect(requirementNeedsSettings({ ...READY, precise: false }, "precise", true)).toBe(false);
  });

  it("precisión y GPS en iOS solo se resuelven desde Ajustes", () => {
    setPlatform("ios");
    expect(requirementNeedsSettings({ ...READY, precise: false }, "precise", false)).toBe(true);
    expect(requirementNeedsSettings({ ...READY, servicesEnabled: false }, "services", false)).toBe(true);
  });

  it("precisión y GPS en Android tienen diálogo propio", () => {
    setPlatform("android");
    expect(requirementNeedsSettings({ ...READY, precise: false }, "precise", false)).toBe(false);
    expect(requirementNeedsSettings({ ...READY, servicesEnabled: false }, "services", false)).toBe(false);
  });
});

describe("resolveCarrierLocationRequirement", () => {
  it("pide el permiso de segundo plano con el diálogo del SO", async () => {
    await resolveCarrierLocationRequirement({ ...READY, backgroundGranted: false }, "background", false);
    expect(mocked.requestBackgroundPermissionsAsync).toHaveBeenCalled();
  });

  it("abre Ajustes cuando el SO ya no puede preguntar", async () => {
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await resolveCarrierLocationRequirement(
      { ...READY, backgroundGranted: false, backgroundCanAskAgain: false },
      "background",
      false,
    );
    expect(openSettings).toHaveBeenCalled();
    expect(mocked.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("en Android activa el GPS con el diálogo del sistema y tolera que lo rechacen", async () => {
    setPlatform("android");
    mocked.enableNetworkProviderAsync.mockRejectedValue(new Error("rechazado"));
    await expect(
      resolveCarrierLocationRequirement({ ...READY, servicesEnabled: false }, "services", false),
    ).resolves.toBeUndefined();
    expect(mocked.enableNetworkProviderAsync).toHaveBeenCalled();
  });
});
