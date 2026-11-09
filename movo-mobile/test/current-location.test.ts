import * as Location from "expo-location";
import { HIGH_ACCURACY_TIMEOUT_MS, getCurrentLocation } from "../src/lib/location";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 1 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockRequest = Location.requestForegroundPermissionsAsync as jest.Mock;
const mockGetPosition = Location.getCurrentPositionAsync as jest.Mock;

const position = (lat: number, lng: number) => ({ coords: { latitude: lat, longitude: lng } });

describe("getCurrentLocation", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRequest.mockResolvedValue({ granted: true });
    mockGetPosition.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("devuelve granted: false sin pedir posición si se niega el permiso", async () => {
    mockRequest.mockResolvedValue({ granted: false });
    await expect(getCurrentLocation({ highAccuracy: true })).resolves.toEqual({ granted: false });
    expect(mockGetPosition).not.toHaveBeenCalled();
  });

  it("con alta precisión usa el fix preciso si llega a tiempo", async () => {
    mockGetPosition.mockResolvedValue(position(-31.4, -64.18));
    await expect(getCurrentLocation({ highAccuracy: true })).resolves.toEqual({
      granted: true,
      lat: -31.4,
      lng: -64.18,
    });
    expect(mockGetPosition).toHaveBeenCalledTimes(1);
    expect(mockGetPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High });
  });

  it("si el fix preciso no llega, cae a la precisión balanceada", async () => {
    mockGetPosition
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(position(-31.41, -64.19));

    const result = getCurrentLocation({ highAccuracy: true });
    await jest.advanceTimersByTimeAsync(HIGH_ACCURACY_TIMEOUT_MS);

    await expect(result).resolves.toEqual({ granted: true, lat: -31.41, lng: -64.19 });
    expect(mockGetPosition).toHaveBeenLastCalledWith({ accuracy: Location.Accuracy.Balanced });
  });

  it("sin alta precisión pide la posición con las opciones por defecto", async () => {
    mockGetPosition.mockResolvedValue(position(1, 2));
    await getCurrentLocation();
    expect(mockGetPosition).toHaveBeenCalledWith({});
  });
});
