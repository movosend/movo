import { TripStatus, tripsClient, type Trip, type TripWithAcceptedPackages } from "../src/api/trips-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

describe("tripsClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockTrip: Trip = {
    id: "trip-1",
    carrierId: "carrier-1",
    originAddress: "Av. Colón 1234, Córdoba",
    originLat: -31.4201,
    originLng: -64.1888,
    destinationAddress: "Av. San Martín 100, Villa María",
    destinationLat: -32.4104,
    destinationLng: -63.2404,
    departureAt: "2026-09-10T12:00:00.000Z",
    vehicleType: "Auto",
    status: TripStatus.ACTIVE,
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
  };

  const mockTripWithPackages: TripWithAcceptedPackages = {
    ...mockTrip,
    hasAcceptedPackages: false,
  };

  it("list calls GET /trips with params", async () => {
    (httpClient.get as jest.Mock).mockResolvedValueOnce({
      items: [mockTripWithPackages],
      page: 1,
      limit: 50,
      total: 1,
    });

    const result = await tripsClient.list({ page: 1, limit: 50 });

    expect(httpClient.get).toHaveBeenCalledWith("/trips", { page: 1, limit: 50 });
    expect(result.items).toEqual([mockTripWithPackages]);
  });

  it("create calls POST /trips with the body", async () => {
    (httpClient.post as jest.Mock).mockResolvedValueOnce(mockTrip);

    const body = {
      originAddress: mockTrip.originAddress,
      originLat: mockTrip.originLat,
      originLng: mockTrip.originLng,
      destinationAddress: mockTrip.destinationAddress,
      destinationLat: mockTrip.destinationLat,
      destinationLng: mockTrip.destinationLng,
      departureAt: mockTrip.departureAt,
      vehicleType: mockTrip.vehicleType,
    };

    const result = await tripsClient.create(body);

    expect(httpClient.post).toHaveBeenCalledWith("/trips", body);
    expect(result).toEqual(mockTrip);
  });

  it("getById calls GET /trips/:id", async () => {
    (httpClient.get as jest.Mock).mockResolvedValueOnce(mockTripWithPackages);

    const result = await tripsClient.getById("trip-1");

    expect(httpClient.get).toHaveBeenCalledWith("/trips/trip-1");
    expect(result).toEqual(mockTripWithPackages);
  });

  it("update calls PATCH /trips/:id with the partial body", async () => {
    (httpClient.patch as jest.Mock).mockResolvedValueOnce({ ...mockTrip, vehicleType: "Camioneta" });

    const result = await tripsClient.update("trip-1", { vehicleType: "Camioneta" });

    expect(httpClient.patch).toHaveBeenCalledWith("/trips/trip-1", { vehicleType: "Camioneta" });
    expect(result.vehicleType).toBe("Camioneta");
  });

  it("remove calls DELETE /trips/:id", async () => {
    (httpClient.delete as jest.Mock).mockResolvedValueOnce(undefined);

    await tripsClient.remove("trip-1");

    expect(httpClient.delete).toHaveBeenCalledWith("/trips/trip-1");
  });
});
