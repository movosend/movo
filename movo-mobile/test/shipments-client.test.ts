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
});
