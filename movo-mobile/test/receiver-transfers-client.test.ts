describe("receiverTransfersClient (MOVO-275)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function setup() {
    jest.doMock("../src/api/http-client", () => ({
      httpClient: {
        get: jest.fn().mockResolvedValue([]),
        post: jest.fn().mockResolvedValue({ id: "tr-1", shipmentId: "s-1" }),
      },
    }));
    const { receiverTransfersClient } = require("../src/api/receiver-transfers-client");
    const { httpClient } = require("../src/api/http-client");
    return { client: receiverTransfersClient, httpClient };
  }

  it("request hace POST /shipments/:id/receiver-transfer con la persona y el motivo", async () => {
    const { client, httpClient } = setup();
    await client.request("s-1", { newReceiverId: "u-2", reason: "De viaje" });
    expect(httpClient.post).toHaveBeenCalledWith("/shipments/s-1/receiver-transfer", {
      newReceiverId: "u-2",
      reason: "De viaje",
    });
  });

  it("listForShipment, listMyInvitations y getById pegan a sus rutas", async () => {
    const { client, httpClient } = setup();
    await client.listForShipment("s-1");
    await client.listMyInvitations();
    await client.getById("tr-1");
    expect(httpClient.get).toHaveBeenNthCalledWith(1, "/shipments/s-1/receiver-transfers");
    expect(httpClient.get).toHaveBeenNthCalledWith(2, "/receiver-transfers/invitations");
    expect(httpClient.get).toHaveBeenNthCalledWith(3, "/receiver-transfers/tr-1");
  });

  it("accept, reject y cancel hacen POST sobre la solicitud", async () => {
    const { client, httpClient } = setup();
    await client.accept("tr-1");
    await client.reject("tr-1", "Ese día trabajo");
    await client.reject("tr-1");
    await client.cancel("tr-1");
    expect(httpClient.post).toHaveBeenNthCalledWith(1, "/receiver-transfers/tr-1/accept", {});
    expect(httpClient.post).toHaveBeenNthCalledWith(2, "/receiver-transfers/tr-1/reject", { reason: "Ese día trabajo" });
    expect(httpClient.post).toHaveBeenNthCalledWith(3, "/receiver-transfers/tr-1/reject", {});
    expect(httpClient.post).toHaveBeenNthCalledWith(4, "/receiver-transfers/tr-1/cancel", {});
  });
});
