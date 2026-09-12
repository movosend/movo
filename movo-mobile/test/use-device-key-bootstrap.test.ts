import { act, renderHook } from "@testing-library/react-native";

const mockUseAuthStore = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => mockUseAuthStore(selector),
}));

const mockGetOrCreateDeviceKeyPair = jest.fn();
jest.mock("../src/crypto/keypair", () => ({
  getOrCreateDeviceKeyPair: () => mockGetOrCreateDeviceKeyPair(),
}));

const mockRegisterDeviceKey = jest.fn();
jest.mock("../src/api/users-client", () => ({
  usersClient: { registerDeviceKey: (publicKey: string) => mockRegisterDeviceKey(publicKey) },
}));

import { useDeviceKeyBootstrap } from "../src/hooks/use-device-key-bootstrap";

function authenticated() {
  mockUseAuthStore.mockImplementation((selector) => selector({ status: "authenticated" }));
}

function unauthenticated() {
  mockUseAuthStore.mockImplementation((selector) => selector({ status: "unauthenticated" }));
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("useDeviceKeyBootstrap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOrCreateDeviceKeyPair.mockResolvedValue({ privateKey: new Uint8Array(32), publicKeyBase64: "pub_b64" });
    mockRegisterDeviceKey.mockResolvedValue({ registeredAt: "2026-01-01T00:00:00.000Z" });
  });

  it("no genera ni registra nada si la sesión no está autenticada", async () => {
    unauthenticated();

    const { result } = await renderHook(() => useDeviceKeyBootstrap());
    await flush();

    expect(mockGetOrCreateDeviceKeyPair).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("AC1: genera y registra la clave una sola vez al detectar sesión autenticada", async () => {
    authenticated();

    const { result, rerender } = await renderHook(() => useDeviceKeyBootstrap());
    await flush();
    await rerender({});
    await rerender({});

    expect(mockGetOrCreateDeviceKeyPair).toHaveBeenCalledTimes(1);
    expect(mockRegisterDeviceKey).toHaveBeenCalledWith("pub_b64");
    expect(result.current.status).toBe("ready");
  });

  it("vuelve a intentar tras un logout/login en el mismo dispositivo", async () => {
    authenticated();
    const { rerender } = await renderHook(() => useDeviceKeyBootstrap());
    await flush();
    expect(mockGetOrCreateDeviceKeyPair).toHaveBeenCalledTimes(1);

    unauthenticated();
    await rerender({});

    authenticated();
    await rerender({});
    await flush();

    expect(mockGetOrCreateDeviceKeyPair).toHaveBeenCalledTimes(2);
  });

  it("AC7: si el registro falla, expone status de error en vez de fallar silenciosamente", async () => {
    authenticated();
    mockRegisterDeviceKey.mockRejectedValue(new Error("network down"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await renderHook(() => useDeviceKeyBootstrap());
    await flush();

    expect(result.current.status).toBe("error");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("AC7: retry() reintenta a demanda y puede terminar en ready tras un error previo", async () => {
    authenticated();
    mockRegisterDeviceKey.mockRejectedValueOnce(new Error("network down"));
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = await renderHook(() => useDeviceKeyBootstrap());
    await flush();
    expect(result.current.status).toBe("error");

    mockRegisterDeviceKey.mockResolvedValue({ registeredAt: "2026-01-01T00:00:00.000Z" });
    await act(async () => {
      result.current.retry();
      await flush();
    });

    expect(result.current.status).toBe("ready");
    expect(mockRegisterDeviceKey).toHaveBeenCalledTimes(2);
  });

  it("vuelve a idle al des-autenticar", async () => {
    authenticated();
    const { result, rerender } = await renderHook(() => useDeviceKeyBootstrap());
    await flush();
    expect(result.current.status).toBe("ready");

    unauthenticated();
    await rerender({});

    expect(result.current.status).toBe("idle");
  });
});
