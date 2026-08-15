import { SECURE_STORE_KEYS } from "../src/lib/secure-store";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn().mockReturnValue("11111111-1111-1111-1111-111111111111"),
}));

describe("getOrCreateDeviceId", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it("genera y persiste un UUID nuevo si no hay ninguno guardado", async () => {
    const { getOrCreateDeviceId } = require("../src/lib/device-id");
    const SecureStore = require("expo-secure-store");

    const deviceId = await getOrCreateDeviceId();

    expect(deviceId).toBe("11111111-1111-1111-1111-111111111111");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SECURE_STORE_KEYS.pushDeviceId,
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("reusa el UUID ya persistido en vez de generar uno nuevo", async () => {
    const SecureStore = require("expo-secure-store");
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("existing-device-id");
    const Crypto = require("expo-crypto");

    const { getOrCreateDeviceId } = require("../src/lib/device-id");
    const deviceId = await getOrCreateDeviceId();

    expect(deviceId).toBe("existing-device-id");
    expect(Crypto.randomUUID).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
