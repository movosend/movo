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

  it("createOffer calls POST /shipments/:id/offers with net price and params", async () => {
    const mockCreatedResponse = {
      ...mockOffer,
      priceNetArs: 13000,
      commissionAmountArs: 2000,
      priceOffered: 15000,
    };
    (httpClient.post as jest.Mock).mockResolvedValueOnce(mockCreatedResponse);

    const result = await offersClient.createOffer("shipment-1", {
      priceOfferedArs: 13000,
      offeredDate: "2026-09-01",
      message: "Llego en horario",
    });

    expect(httpClient.post).toHaveBeenCalledWith("/shipments/shipment-1/offers", {
      priceOfferedArs: 13000,
      offeredDate: "2026-09-01",
      message: "Llego en horario",
    });
    expect(result).toEqual(mockCreatedResponse);
    expect(result.priceNetArs).toBe(13000);
    expect(result.commissionAmountArs).toBe(2000);
  });

  it("withdrawOffer calls POST /offers/:id/withdraw", async () => {
    (httpClient.post as jest.Mock).mockResolvedValueOnce({
      ...mockOffer,
      status: OfferStatus.WITHDRAWN,
    });

    const result = await offersClient.withdrawOffer("offer-1");

    expect(httpClient.post).toHaveBeenCalledWith("/offers/offer-1/withdraw");
    expect(result.status).toBe(OfferStatus.WITHDRAWN);
  });

  it("listMyOffers calls GET /offers/mine with query params", async () => {
    const mockListMine = {
      items: [
        {
          ...mockOffer,
          shipment: {
            id: "shipment-1",
            status: "published",
            pickupAddress: "Av. Colón 1234",
            pickupDate: "2026-09-01",
            deliveryAddress: "Bv. San Juan 500",
          },
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    };
    (httpClient.get as jest.Mock).mockResolvedValueOnce(mockListMine);

    const result = await offersClient.listMyOffers({ status: OfferStatus.PENDING });

    expect(httpClient.get).toHaveBeenCalledWith("/offers/mine", {
      status: OfferStatus.PENDING,
    });
    expect(result).toEqual(mockListMine);
  });
});
