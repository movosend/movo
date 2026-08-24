const originalEnv = process.env.EXPO_PUBLIC_API_URL;

// El store vive en `globalThis` (no en el scope del factory) porque
// `jest.resetModules()` reinstancia el mock en cada test que necesita
// simular un reinicio de la app (ver test de persistencia entre loads) —
// un Map local al factory se perdería en ese reset.
(globalThis as { __secureStoreMock?: Map<string, string> }).__secureStoreMock ??= new Map();

jest.mock("expo-secure-store", () => {
  const store = (globalThis as unknown as { __secureStoreMock: Map<string, string> }).__secureStoreMock;
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

describe("api-override", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = "https://api-dev.movosend.app";
    (globalThis as { __secureStoreMock?: Map<string, string> }).__secureStoreMock?.clear();
    jest.resetModules();
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalEnv;
  });

  it("sin override, getApiBaseUrl usa EXPO_PUBLIC_API_URL", () => {
    const { getApiBaseUrl } = require("../src/lib/env");
    expect(getApiBaseUrl()).toBe("https://api-dev.movosend.app");
  });

  it("setApiOverride reemplaza la URL efectiva en __DEV__, y se persiste entre loads", async () => {
    const { setApiOverride, loadApiOverride } = require("../src/lib/api-override");
    const { getApiBaseUrl } = require("../src/lib/env");

    await setApiOverride("http://192.168.1.10:3000/");
    expect(getApiBaseUrl()).toBe("http://192.168.1.10:3000");

    jest.resetModules();
    const reloaded = require("../src/lib/api-override");
    const envAfterReload = require("../src/lib/env");
    expect(reloaded.getApiOverride()).toBeNull();
    await reloaded.loadApiOverride();
    expect(reloaded.getApiOverride()).toBe("http://192.168.1.10:3000");
    expect(envAfterReload.getApiBaseUrl()).toBe("http://192.168.1.10:3000");
  });

  it("setApiOverride(null) limpia el override y vuelve a EXPO_PUBLIC_API_URL", async () => {
    const { setApiOverride } = require("../src/lib/api-override");
    const { getApiBaseUrl } = require("../src/lib/env");

    await setApiOverride("http://192.168.1.10:3000");
    expect(getApiBaseUrl()).toBe("http://192.168.1.10:3000");

    await setApiOverride(null);
    expect(getApiBaseUrl()).toBe("https://api-dev.movosend.app");
  });

  it("ignora el override cuando __DEV__ es false (build de producción)", async () => {
    const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    const { setApiOverride } = require("../src/lib/api-override");
    const { getApiBaseUrl } = require("../src/lib/env");
    await setApiOverride("http://192.168.1.10:3000");

    expect(getApiBaseUrl()).toBe("https://api-dev.movosend.app");

    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });
});
