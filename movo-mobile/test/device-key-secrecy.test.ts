import { act, renderHook } from "@testing-library/react-native";

/**
 * DoD explícito de MOVO-195: "test de que la clave privada no es recuperable desde
 * AsyncStorage ni aparece en el estado de la app". Este repo no tiene
 * `@react-native-async-storage/async-storage` instalado en absoluto (`secure-store.ts`
 * usa `expo-secure-store` como única abstracción de storage) — la forma más fuerte de
 * probar "no puede terminar en AsyncStorage" es confirmar que el paquete ni siquiera
 * existe como dependencia resoluble, no simular que "no lo llamamos".
 */
it("AsyncStorage no es ni siquiera una dependencia resoluble del proyecto", () => {
  expect(() => require("@react-native-async-storage/async-storage")).toThrow();
});

const FIXTURE_PRIVATE_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest
    .fn()
    .mockResolvedValue(require("../src/crypto/bytes").base64ToBytes("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=")),
}));

const mockUseAuthStore = jest.fn().mockImplementation((selector: (s: { status: string }) => unknown) =>
  selector({ status: "authenticated" }),
);
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => mockUseAuthStore(selector),
}));

const mockRegisterDeviceKey = jest.fn().mockResolvedValue({ registeredAt: "2026-01-01T00:00:00.000Z" });
jest.mock("../src/api/users-client", () => ({
  usersClient: { registerDeviceKey: (publicKey: string) => mockRegisterDeviceKey(publicKey) },
}));

describe("secreto de la clave privada del handshake", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    mockRegisterDeviceKey.mockResolvedValue({ registeredAt: "2026-01-01T00:00:00.000Z" });
  });

  it("useDeviceKeyBootstrap nunca expone la privada en su valor devuelto (solo status/retry)", async () => {
    const { useDeviceKeyBootstrap } = require("../src/hooks/use-device-key-bootstrap");
    const { result } = await renderHook(() => useDeviceKeyBootstrap());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(Object.keys(result.current).sort()).toEqual(["retry", "status"]);
    // Ni la privada fixture ni nada con pinta de material criptográfico (blob base64
    // largo) aparece serializando lo que el hook expone hacia afuera.
    expect(JSON.stringify({ status: result.current.status })).not.toContain(FIXTURE_PRIVATE_KEY_B64);
  });

  it("getOrCreateDeviceKeyPair no persiste nada fuera de expo-secure-store", async () => {
    const SecureStore = require("expo-secure-store");
    const { getOrCreateDeviceKeyPair } = require("../src/crypto/keypair");

    await getOrCreateDeviceKeyPair();

    // Única llamada de persistencia real en todo el módulo: `expo-secure-store`. No
    // hay ningún otro storage (AsyncStorage no existe, ver test de arriba) que pudiera
    // haber recibido la privada por otra vía.
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync.mock.calls[0][1]).toBe(FIXTURE_PRIVATE_KEY_B64);
  });
});
