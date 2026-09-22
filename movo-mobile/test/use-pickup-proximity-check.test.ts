import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePickupProximityCheck } from "../src/hooks/use-pickup-proximity-check";
import { getCurrentLocation } from "../src/lib/location";

jest.mock("../src/lib/location", () => ({
  getCurrentLocation: jest.fn(),
}));

describe("usePickupProximityCheck", () => {
  afterEach(() => jest.clearAllMocks());

  it("arranca en idle y no llama a getCurrentLocation hasta que se invoca check()", async () => {
    const { result } = await renderHook(() => usePickupProximityCheck(-31.4, -64.18));

    expect(result.current.status).toBe("idle");
    expect(getCurrentLocation).not.toHaveBeenCalled();
  });

  it("dentro del radio de 100m resuelve within_range", async () => {
    // ~30m al norte del punto de retiro.
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.3997, lng: -64.18 });
    const { result } = await renderHook(() => usePickupProximityCheck(-31.4, -64.18));

    await act(async () => {
      await result.current.check();
    });

    await waitFor(() => expect(result.current.status).toBe("within_range"));
    expect(result.current.distanceMeters).toBeLessThanOrEqual(100);
    expect(result.current.currentLocation).toEqual({ lat: -31.3997, lng: -64.18 });
  });

  it("fuera del radio de 100m resuelve out_of_range con la distancia calculada", async () => {
    // ~1.1km al norte del punto de retiro.
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: true, lat: -31.39, lng: -64.18 });
    const { result } = await renderHook(() => usePickupProximityCheck(-31.4, -64.18));

    await act(async () => {
      await result.current.check();
    });

    await waitFor(() => expect(result.current.status).toBe("out_of_range"));
    expect(result.current.distanceMeters).toBeGreaterThan(100);
  });

  it("permiso denegado resuelve denied sin inventar una distancia", async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue({ granted: false });
    const { result } = await renderHook(() => usePickupProximityCheck(-31.4, -64.18));

    await act(async () => {
      await result.current.check();
    });

    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.distanceMeters).toBeNull();
    expect(result.current.currentLocation).toBeNull();
  });

  it("un fallo inesperado de GPS resuelve error", async () => {
    (getCurrentLocation as jest.Mock).mockRejectedValue(new Error("gps down"));
    const { result } = await renderHook(() => usePickupProximityCheck(-31.4, -64.18));

    await act(async () => {
      await result.current.check();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
