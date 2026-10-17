import { afterEach, describe, expect, it, vi } from "vitest";
import { createShipmentsClient, ShipmentsUnavailableError } from "../src/adapters/shipments-client";

describe("ShipmentsClient.resolveLedgerOrigins", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envía el usuario y los ids y valida la respuesta", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: "s1", label: "Envío a Córdoba" }] });
    vi.stubGlobal("fetch", fetch);
    const result = await createShipmentsClient("http://shipments").resolveLedgerOrigins("u1", ["s1"]);
    expect(result).toEqual([{ id: "s1", label: "Envío a Córdoba" }]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ userId: "u1", shipmentIds: ["s1"] });
  });

  it("rechaza un payload inválido para que el saldo pueda hacer fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "s1" }) }));
    await expect(createShipmentsClient("http://shipments").resolveLedgerOrigins("u1", ["s1"]))
      .rejects.toBeInstanceOf(ShipmentsUnavailableError);
  });
});
