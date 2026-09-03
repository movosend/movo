import { ratingsClient, type Rating } from "../src/api/ratings-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

describe("ratingsClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockRating: Rating = {
    id: "rating-1",
    shipmentId: "shipment-1",
    raterId: "sender-1",
    rateeId: "carrier-1",
    role: "carrier",
    score: 5,
    comment: "Excelente servicio y puntualidad",
    createdAt: "2026-09-01T14:00:00.000Z",
  };

  it("createRating envía POST /shipments/:id/ratings con el body esperado", async () => {
    (httpClient.post as jest.Mock).mockResolvedValueOnce(mockRating);

    const result = await ratingsClient.createRating("shipment-1", {
      rateeId: "carrier-1",
      score: 5,
      comment: "Excelente servicio y puntualidad",
    });

    expect(httpClient.post).toHaveBeenCalledWith("/shipments/shipment-1/ratings", {
      rateeId: "carrier-1",
      score: 5,
      comment: "Excelente servicio y puntualidad",
    });
    expect(result).toEqual(mockRating);
  });

  it("updateRating envía PATCH /shipments/:id/ratings/:rateeId con el body esperado", async () => {
    const updatedRating = { ...mockRating, score: 4, comment: "Editado" };
    (httpClient.patch as jest.Mock).mockResolvedValueOnce(updatedRating);

    const result = await ratingsClient.updateRating("shipment-1", "carrier-1", {
      score: 4,
      comment: "Editado",
    });

    expect(httpClient.patch).toHaveBeenCalledWith(
      "/shipments/shipment-1/ratings/carrier-1",
      { score: 4, comment: "Editado" }
    );
    expect(result).toEqual(updatedRating);
  });

  it("listShipmentRatings envía GET /shipments/:id/ratings", async () => {
    (httpClient.get as jest.Mock).mockResolvedValueOnce([mockRating]);

    const result = await ratingsClient.listShipmentRatings("shipment-1");

    expect(httpClient.get).toHaveBeenCalledWith("/shipments/shipment-1/ratings");
    expect(result).toEqual([mockRating]);
  });
});
