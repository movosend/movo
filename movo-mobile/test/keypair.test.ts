import { SECURE_STORE_KEYS } from "../src/lib/secure-store";
import { base64ToBytes } from "../src/crypto/bytes";

// Escalar chico pero válido para P-256 (0x00...01) -- fixture determinística, no un
// valor real de producción. Pública esperada calculada una sola vez con
// `p256.getPublicKey` y verificada a mano (ver el PR de MOVO-195).
const FIXTURE_PRIVATE_KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=";
const FIXTURE_PUBLIC_KEY_B64 =
  "BGsX0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT+NC4v4af5uO5+tKfA+eFivOM1drMV7Oy7ZAaDe/UfU=";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(),
}));

describe("getOrCreateDeviceKeyPair", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it("genera y persiste una clave privada nueva si no hay ninguna guardada", async () => {
    const SecureStore = require("expo-secure-store");
    const Crypto = require("expo-crypto");
    (Crypto.getRandomBytesAsync as jest.Mock).mockResolvedValue(base64ToBytes(FIXTURE_PRIVATE_KEY_B64));

    const { getOrCreateDeviceKeyPair } = require("../src/crypto/keypair");
    const { privateKey, publicKeyBase64 } = await getOrCreateDeviceKeyPair();

    expect(publicKeyBase64).toBe(FIXTURE_PUBLIC_KEY_B64);
    expect(Array.from(privateKey)).toEqual(Array.from(base64ToBytes(FIXTURE_PRIVATE_KEY_B64)));
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SECURE_STORE_KEYS.handshakeDevicePrivateKey,
      FIXTURE_PRIVATE_KEY_B64,
    );
  });

  it("reusa la clave privada ya persistida en vez de generar una nueva", async () => {
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(FIXTURE_PRIVATE_KEY_B64);
    const Crypto = require("expo-crypto");

    const { getOrCreateDeviceKeyPair } = require("../src/crypto/keypair");
    const { publicKeyBase64 } = await getOrCreateDeviceKeyPair();

    expect(publicKeyBase64).toBe(FIXTURE_PUBLIC_KEY_B64);
    expect(Crypto.getRandomBytesAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("la clave pública exportada tiene el formato raw sin comprimir (65 bytes, 0x04 inicial)", async () => {
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(FIXTURE_PRIVATE_KEY_B64);

    const { getOrCreateDeviceKeyPair } = require("../src/crypto/keypair");
    const { publicKeyBase64 } = await getOrCreateDeviceKeyPair();

    const publicKeyBytes = base64ToBytes(publicKeyBase64);
    expect(publicKeyBytes.length).toBe(65);
    expect(publicKeyBytes[0]).toBe(0x04);
  });

  it("reintenta la generación si el primer candidato random no es un escalar válido", async () => {
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const Crypto = require("expo-crypto");
    // Todo-ceros no es un escalar válido para P-256 (fuera de [1, n-1]) -- el segundo
    // intento sí lo es.
    (Crypto.getRandomBytesAsync as jest.Mock)
      .mockResolvedValueOnce(new Uint8Array(32))
      .mockResolvedValueOnce(base64ToBytes(FIXTURE_PRIVATE_KEY_B64));

    const { getOrCreateDeviceKeyPair } = require("../src/crypto/keypair");
    const { publicKeyBase64 } = await getOrCreateDeviceKeyPair();

    expect(publicKeyBase64).toBe(FIXTURE_PUBLIC_KEY_B64);
    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledTimes(2);
  });
});
