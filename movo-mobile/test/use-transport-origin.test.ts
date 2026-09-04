import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useTransportOrigin } from "../src/hooks/use-transport-origin";

const mockResolveCurrentLocation = jest.fn();
jest.mock("../src/hooks/use-my-location", () => ({
  useMyLocation: () => ({ resolveCurrentLocation: mockResolveCurrentLocation }),
}));

const mockUseAddresses = jest.fn();
jest.mock("../src/hooks/use-addresses", () => ({
  useAddresses: () => mockUseAddresses(),
}));

describe("useTransportOrigin", () => {
  afterEach(() => jest.clearAllMocks());

  it("usa el GPS cuando el permiso está concedido", async () => {
    mockResolveCurrentLocation.mockResolvedValue({
      address: "Av. Colón 1234, Córdoba",
      lat: -31.4,
      lng: -64.18,
      source: "gps",
    });
    mockUseAddresses.mockReturnValue({ data: [], isLoading: false });

    const { result } = await renderHook(() => useTransportOrigin());

    await waitFor(() => expect(result.current.resolving).toBe(false));

    expect(result.current.origin).toEqual({
      lat: -31.4,
      lng: -64.18,
      address: "Av. Colón 1234, Córdoba",
      source: "gps",
    });
    expect(result.current.needsManualPick).toBe(false);
  });

  it("con GPS denegado, cae a la dirección default de la libreta", async () => {
    mockResolveCurrentLocation.mockResolvedValue(null);
    mockUseAddresses.mockReturnValue({
      data: [
        { id: "a1", label: "Casa", street: "Bv. San Juan", streetNumber: "500", city: "Córdoba", lat: -31.41, long: -64.19, isDefault: false },
        { id: "a2", label: "Depósito", street: "Av. Colón", streetNumber: "1000", city: "Córdoba", lat: -31.42, long: -64.2, isDefault: true },
      ],
      isLoading: false,
    });

    const { result } = await renderHook(() => useTransportOrigin());

    await waitFor(() => expect(result.current.resolving).toBe(false));

    expect(result.current.origin).toEqual({
      lat: -31.42,
      lng: -64.2,
      address: "Depósito",
      source: "saved",
      city: "Córdoba",
    });
    expect(result.current.needsManualPick).toBe(false);
  });

  it("sin GPS ni dirección default, pide selección manual", async () => {
    mockResolveCurrentLocation.mockResolvedValue(null);
    mockUseAddresses.mockReturnValue({ data: [], isLoading: false });

    const { result } = await renderHook(() => useTransportOrigin());

    await waitFor(() => expect(result.current.resolving).toBe(false));

    expect(result.current.origin).toBeNull();
    expect(result.current.needsManualPick).toBe(true);
  });

  it("una selección manual gana por sobre GPS y dirección default", async () => {
    mockResolveCurrentLocation.mockResolvedValue({
      address: "Av. Colón 1234, Córdoba",
      lat: -31.4,
      lng: -64.18,
      source: "gps",
    });
    mockUseAddresses.mockReturnValue({ data: [], isLoading: false });

    const { result } = await renderHook(() => useTransportOrigin());
    await waitFor(() => expect(result.current.resolving).toBe(false));

    await act(async () => {
      result.current.setManualSelection({ address: "Elegida a mano", lat: -31.5, lng: -64.3, source: "map-pin" });
    });

    expect(result.current.origin).toEqual({ lat: -31.5, lng: -64.3, address: "Elegida a mano", source: "map-pin" });
  });
});
