import { vehicleClient } from "../src/api/vehicle-client";
import { httpClient } from "../src/api/http-client";
import type { VehicleProfile } from "@movo/shared/dist/types/user-profile";

jest.mock("../src/api/http-client", () => ({
  httpClient: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

describe("vehicleClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockVehicle: VehicleProfile = {
    brand: "Renault",
    model: "Kangoo",
    cargoCapacityLabel: "Baúl mediano · hasta 15 kg",
    licensePlate: "AB123CD",
  };

  it("getMyVehicle envía GET /users/me/vehicle y devuelve el vehículo", async () => {
    (httpClient.get as jest.Mock).mockResolvedValueOnce(mockVehicle);

    const result = await vehicleClient.getMyVehicle();

    expect(httpClient.get).toHaveBeenCalledWith("/users/me/vehicle");
    expect(result).toEqual(mockVehicle);
  });

  it("getMyVehicle devuelve null si el usuario todavía no cargó ficha", async () => {
    (httpClient.get as jest.Mock).mockResolvedValueOnce(null);

    const result = await vehicleClient.getMyVehicle();

    expect(httpClient.get).toHaveBeenCalledWith("/users/me/vehicle");
    expect(result).toBeNull();
  });

  it("upsertMyVehicle envía PUT /users/me/vehicle con el body esperado", async () => {
    (httpClient.put as jest.Mock).mockResolvedValueOnce(mockVehicle);

    const result = await vehicleClient.upsertMyVehicle(mockVehicle);

    expect(httpClient.put).toHaveBeenCalledWith("/users/me/vehicle", mockVehicle);
    expect(result).toEqual(mockVehicle);
  });
});
