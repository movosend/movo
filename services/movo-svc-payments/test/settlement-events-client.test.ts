import { afterEach, describe, expect, it, vi } from "vitest";
import { createShipmentsClient, ShipmentNotFoundError, ShipmentsUnavailableError } from "../src/adapters/shipments-client";

// MOVO-213: el aviso de payments a shipments (`POST /internal/shipments/:id/settlement-events`).
describe("ShipmentsClient.notifySettlementEvent", () => {
  afterEach(() => vi.unstubAllGlobals());
  const client = () => createShipmentsClient("http://shipments");

  it("manda el evento al envío y devuelve la respuesta", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ handled: true, outcome: "carrier_notified" }) });
    vi.stubGlobal("fetch", fetch);

    const result = await client().notifySettlementEvent("s 1", "delayed");

    expect(result).toEqual({ handled: true, outcome: "carrier_notified" });
    expect(fetch.mock.calls[0][0]).toBe("http://shipments/internal/shipments/s%201/settlement-events");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ event: "delayed" });
  });

  it("un envío desconocido para shipments es ShipmentNotFoundError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    await expect(client().notifySettlementEvent("s1", "credited")).rejects.toBeInstanceOf(ShipmentNotFoundError);
  });

  it("un 5xx, una red caída o una respuesta inválida son ShipmentsUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(client().notifySettlementEvent("s1", "delayed")).rejects.toBeInstanceOf(ShipmentsUnavailableError);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(client().notifySettlementEvent("s1", "delayed")).rejects.toBeInstanceOf(ShipmentsUnavailableError);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ handled: "sí" }) }));
    await expect(client().notifySettlementEvent("s1", "delayed")).rejects.toBeInstanceOf(ShipmentsUnavailableError);
  });
});
