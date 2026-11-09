import { act, renderHook } from "@testing-library/react-native";
import { REVERSE_GEOCODE_FAILED_MESSAGE, useMyLocation } from "../src/hooks/use-my-location";

const mockGetCurrentLocation = jest.fn();
const mockReverseGeocode = jest.fn();

jest.mock("../src/lib/location", () => ({
  getCurrentLocation: () => mockGetCurrentLocation(),
}));

jest.mock("../src/api/geocode-client", () => ({
  geocodeClient: { reverseGeocode: (lat: number, lng: number) => mockReverseGeocode(lat, lng) },
}));

describe("useMyLocation", () => {
  beforeEach(() => {
    mockGetCurrentLocation.mockReset().mockResolvedValue({ granted: true, lat: -31.41, lng: -64.19 });
    mockReverseGeocode.mockReset();
  });

  it("devuelve la dirección que resuelve el reverse-geocode", async () => {
    mockReverseGeocode.mockResolvedValue({ formattedAddress: "Av. Colón 500, Córdoba" });
    const { result } = await renderHook(() => useMyLocation());

    let selection: Awaited<ReturnType<typeof result.current.resolveCurrentLocation>> = null;
    await act(async () => {
      selection = await result.current.resolveCurrentLocation();
    });

    expect(selection).toEqual({ address: "Av. Colón 500, Córdoba", lat: -31.41, lng: -64.19, source: "gps" });
    expect(result.current.error).toBeNull();
  });

  it("si el reverse-geocode falla, no devuelve una dirección sin nombre y deja el error para mostrar", async () => {
    mockReverseGeocode.mockRejectedValue(new Error("502"));
    const { result } = await renderHook(() => useMyLocation());

    let selection: Awaited<ReturnType<typeof result.current.resolveCurrentLocation>> = null;
    await act(async () => {
      selection = await result.current.resolveCurrentLocation();
    });

    expect(selection).toBeNull();
    expect(result.current.error).toBe(REVERSE_GEOCODE_FAILED_MESSAGE);
  });

  it("con requireAddress: false conserva el punto GPS aunque falle el reverse-geocode", async () => {
    mockReverseGeocode.mockRejectedValue(new Error("502"));
    const { result } = await renderHook(() => useMyLocation());

    let selection: Awaited<ReturnType<typeof result.current.resolveCurrentLocation>> = null;
    await act(async () => {
      selection = await result.current.resolveCurrentLocation({ requireAddress: false });
    });

    expect(selection).toMatchObject({ lat: -31.41, lng: -64.19, source: "gps" });
    expect(result.current.error).toBeNull();
  });

  it("sin permiso de ubicación no llama al reverse-geocode", async () => {
    mockGetCurrentLocation.mockResolvedValue({ granted: false });
    const { result } = await renderHook(() => useMyLocation());

    await act(async () => {
      await result.current.resolveCurrentLocation();
    });

    expect(mockReverseGeocode).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Necesitamos permiso de ubicación para usar tu posición actual.");
  });
});
