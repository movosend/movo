describe("shipmentsClient", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("accept hace POST /shipments/:id/accept con body vacío", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        post: jest.fn().mockResolvedValue({ id: "shipment-1", status: "published" }),
      },
    }));
    const { shipmentsClient } = require("../src/api/shipments-client");
    const { httpClient } = require("../src/api/http-client");

    const result = await shipmentsClient.accept("shipment-1");

    expect(httpClient.post).toHaveBeenCalledWith("/shipments/shipment-1/accept", {});
    expect(result.status).toBe("published");
  });

  it("reject hace POST /shipments/:id/reject con el motivo opcional", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        post: jest.fn().mockResolvedValue({ id: "shipment-1", status: "rejected_by_receiver" }),
      },
    }));
    const { shipmentsClient } = require("../src/api/shipments-client");
    const { httpClient } = require("../src/api/http-client");

    const result = await shipmentsClient.reject("shipment-1", { reason: "Dirección incorrecta" });

    expect(httpClient.post).toHaveBeenCalledWith("/shipments/shipment-1/reject", {
      reason: "Dirección incorrecta",
    });
    expect(result.status).toBe("rejected_by_receiver");
  });

  it("reject pasa body vacío si no se proporciona motivo", async () => {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        post: jest.fn().mockResolvedValue({ id: "shipment-1", status: "rejected_by_receiver" }),
      },
    }));
    const { shipmentsClient } = require("../src/api/shipments-client");
    const { httpClient } = require("../src/api/http-client");

    await shipmentsClient.reject("shipment-1");

    expect(httpClient.post).toHaveBeenCalledWith("/shipments/shipment-1/reject", {});
  });

  it("generateHandshake hace POST /shipments/:id/handshake/generate con lat/lng (MOVO-160, harness de /dev-handshake)", async () => {
    const response = {
      shipmentId: "shipment-1",
      stage: "pickup",
      nonce: "nonce-1",
      canonicalPayload: "shipment-1:pickup:nonce-1",
      expiresAt: "2026-09-13T10:00:15.000Z",
      ttlSeconds: 15,
    };
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { post: jest.fn().mockResolvedValue(response) },
    }));
    const { shipmentsClient } = require("../src/api/shipments-client");
    const { httpClient } = require("../src/api/http-client");

    const result = await shipmentsClient.generateHandshake("shipment-1", { lat: -31.4, lng: -64.2 });

    expect(httpClient.post).toHaveBeenCalledWith("/shipments/shipment-1/handshake/generate", {
      lat: -31.4,
      lng: -64.2,
    });
    expect(result).toEqual(response);
  });

  it("confirmHandshake hace POST /shipments/:id/handshake/confirm con nonce/signature/lat/lng (MOVO-160)", async () => {
    const response = {
      shipmentId: "shipment-1",
      stage: "pickup",
      previousStatus: "assigned",
      status: "in_transit",
      distanceM: 5.2,
      confirmedAt: "2026-09-13T10:00:00.000Z",
    };
    jest.doMock("../src/api/http-client", () => ({
      httpClient: { post: jest.fn().mockResolvedValue(response) },
    }));
    const { shipmentsClient } = require("../src/api/shipments-client");
    const { httpClient } = require("../src/api/http-client");

    const result = await shipmentsClient.confirmHandshake("shipment-1", {
      nonce: "nonce-1",
      signature: "sig-1",
      lat: -31.4,
      lng: -64.2,
    });

    expect(httpClient.post).toHaveBeenCalledWith("/shipments/shipment-1/handshake/confirm", {
      nonce: "nonce-1",
      signature: "sig-1",
      lat: -31.4,
      lng: -64.2,
    });
    expect(result).toEqual(response);
  });
});
