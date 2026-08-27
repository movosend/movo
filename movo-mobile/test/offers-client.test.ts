import { OfferStatus } from "@movo/shared/dist/types/offer";
import { offersClient, type OfferSummary } from "../src/api/offers-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe("offersClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockOffer: OfferSummary = {
    id: "offer-1",
    shipmentId: "shipment-1",
    carrierId: "carrier-1",
    priceOffered: 15000,
    offeredDate: "2026-09-01T10:00:00.000Z",
    message: "Llego en horario",
    carrierRatingAtOffer: 4.8,
    carrierNameAtOffer: "Carlos Transportista",
    status: OfferStatus.PENDING,
    expiresAt: null,
    createdAt: "2026-08-25T12:00:00.000Z",
    respondedAt: null,
  };

  it("listShipmentOffers calls GET /shipments/:id/offers with params", async () => {
    (httpClient.get as jest.Mock).mockResolvedValueOnce([mockOffer]);

    const result = await offersClient.listShipmentOffers("shipment-1", {
      sort: "price",
      includeResolved: true,
    });

    expect(httpClient.get).toHaveBeenCalledWith("/shipments/shipment-1/offers", {
      sort: "price",
      includeResolved: true,
    });
    expect(result).toEqual([mockOffer]);
  });

  it("acceptOffer calls POST /offers/:id/accept", async () => {
    (httpClient.post as jest.Mock).mockResolvedValueOnce({
      ...mockOffer,
      status: OfferStatus.ACCEPTED,
    });

    const result = await offersClient.acceptOffer("offer-1");

    expect(httpClient.post).toHaveBeenCalledWith("/offers/offer-1/accept");
    expect(result.status).toBe(OfferStatus.ACCEPTED);
  });

  it("rejectOffer calls POST /offers/:id/reject", async () => {
    (httpClient.post as jest.Mock).mockResolvedValueOnce({
      ...mockOffer,
      status: OfferStatus.REJECTED,
    });

    const result = await offersClient.rejectOffer("offer-1");

    expect(httpClient.post).toHaveBeenCalledWith("/offers/offer-1/reject");
    expect(result.status).toBe(OfferStatus.REJECTED);
  });
});
