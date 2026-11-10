import * as Location from "expo-location";
import {
  HIGH_ACCURACY_TIMEOUT_MS,
  getCurrentLocation,
  headingFromCoords,
  watchForegroundLocation,
} from "../src/lib/location";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4, Low: 1 },
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
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

describe("headingFromCoords (MOVO-357)", () => {
  it("devuelve el rumbo entero solo si el GPS lo informa y el auto se mueve", () => {
    expect(headingFromCoords({ heading: 271.6, speed: 8 })).toBe(272);
    expect(headingFromCoords({ heading: 359.7, speed: 8 })).toBe(0);
  });

  it("descarta el rumbo inválido (-1 en iOS, null) o con el auto quieto", () => {
    expect(headingFromCoords({ heading: -1, speed: 8 })).toBeUndefined();
    expect(headingFromCoords({ heading: null, speed: 8 })).toBeUndefined();
    expect(headingFromCoords({ heading: 90, speed: 0.5 })).toBeUndefined();
    expect(headingFromCoords({ heading: 90, speed: null })).toBeUndefined();
  });
});

describe("watchForegroundLocation (MOVO-357)", () => {
  const mockGetPermission = Location.getForegroundPermissionsAsync as jest.Mock;
  const mockWatch = Location.watchPositionAsync as jest.Mock;

  beforeEach(() => {
    mockGetPermission.mockResolvedValue({ granted: true });
    mockWatch.mockReset();
  });

  it("sigue la posición con precisión alta y pasa el rumbo cuando el auto se mueve", async () => {
    const remove = jest.fn();
    let emit: ((position: unknown) => void) | null = null;
    mockWatch.mockImplementation(async (_options, callback) => {
      emit = callback;
      return { remove };
    });
    const onChange = jest.fn();

    const stop = await watchForegroundLocation(onChange);

    expect(mockWatch).toHaveBeenCalledWith(
      { accuracy: Location.Accuracy.High, timeInterval: 3_000, distanceInterval: 10 },
      expect.any(Function),
    );
    emit!({ coords: { latitude: -31.4, longitude: -64.18, heading: 90, speed: 10 } });
    emit!({ coords: { latitude: -31.41, longitude: -64.18, heading: -1, speed: 0 } });
    expect(onChange).toHaveBeenNthCalledWith(1, { lat: -31.4, lng: -64.18, heading: 90 });
    expect(onChange).toHaveBeenNthCalledWith(2, { lat: -31.41, lng: -64.18 });

    stop();
    expect(remove).toHaveBeenCalled();
  });

  it("sin permiso no se suscribe", async () => {
    mockGetPermission.mockResolvedValue({ granted: false });
    await watchForegroundLocation(jest.fn());
    expect(mockWatch).not.toHaveBeenCalled();
  });
});
