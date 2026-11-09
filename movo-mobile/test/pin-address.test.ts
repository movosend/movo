import {
  PIN_ADDRESS_FALLBACK,
  resolvePinAddress,
} from "../src/lib/pin-address";

const mockReverseGeocode = jest.fn();
jest.mock("../src/api/geocode-client", () => ({
  geocodeClient: {
    reverseGeocode: (lat: number, lng: number) => mockReverseGeocode(lat, lng),
  },
}));

describe("resolvePinAddress", () => {
  beforeEach(() => mockReverseGeocode.mockReset());

  it("devuelve la dirección del punto nuevo", async () => {
    mockReverseGeocode.mockResolvedValue({
      formattedAddress: "Av. Colón 6051, Córdoba",
    });
    await expect(resolvePinAddress(-31.4, -64.2)).resolves.toBe(
      "Av. Colón 6051, Córdoba",
    );
    expect(mockReverseGeocode).toHaveBeenCalledWith(-31.4, -64.2);
  });

  it("si el reverse-geocode falla usa el texto genérico", async () => {
    mockReverseGeocode.mockRejectedValue(new Error("502"));
    await expect(resolvePinAddress(-31.4, -64.2)).resolves.toBe(
      PIN_ADDRESS_FALLBACK,
    );
  });

  it("una respuesta vacía también cae al texto genérico", async () => {
    mockReverseGeocode.mockResolvedValue({ formattedAddress: "  " });
    await expect(resolvePinAddress(-31.4, -64.2)).resolves.toBe(
      PIN_ADDRESS_FALLBACK,
    );
  });
});
