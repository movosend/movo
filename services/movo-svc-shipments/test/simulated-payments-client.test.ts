import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createAppPaymentsClient,
  withSimulatedPayments,
} from "../src/adapters/simulated-payments-client";
import { createFakePaymentsClient } from "./fake-payments-client";

const SHIPMENT_ID = "11111111-1111-4111-8111-111111111111";
const CARRIER_ID = "22222222-2222-4222-8222-222222222222";

function build(simulated: boolean) {
  const inner = createFakePaymentsClient();
  const spies = {
    find: vi.spyOn(inner, "findHoldByShipment"),
    release: vi.spyOn(inner, "releaseHold"),
    capture: vi.spyOn(inner, "captureHold"),
    settlement: vi.spyOn(inner, "findSettlement"),
    ledger: vi.spyOn(inner, "createLedgerEntry"),
  };
  const clear = vi.fn(async () => undefined);
  const client = withSimulatedPayments(
    inner,
    async () => simulated,
    async () => CARRIER_ID,
    clear,
  );
  return { client, spies, clear };
}

describe("withSimulatedPayments (ADR-055)", () => {
  it("un envío simulado responde con un hold autorizado sin llamar a payments", async () => {
    const { client, spies } = build(true);
    const hold = await client.findHoldByShipment(SHIPMENT_ID, { sync: true });
    expect(hold).toMatchObject({
      status: "authorized",
      shipmentId: SHIPMENT_ID,
      carrierId: CARRIER_ID,
      amountArs: 0,
    });
    expect(spies.find).not.toHaveBeenCalled();
  });

  it("captura y liquidación son un cobro acreditado en $0", async () => {
    const { client, spies } = build(true);
    const settlement = await client.captureHold(SHIPMENT_ID);
    expect(settlement).toMatchObject({
      status: "credited",
      kind: "delivery",
      grossAmountArs: 0,
      netAmountArs: 0,
    });
    expect(await client.findSettlement(SHIPMENT_ID)).toMatchObject({
      status: "credited",
    });
    expect(spies.capture).not.toHaveBeenCalled();
    expect(spies.settlement).not.toHaveBeenCalled();
  });

  it("liberar desmarca el envío, para que si se reasigna vuelva a cobrarse de verdad", async () => {
    const { client, spies, clear } = build(true);
    const released = await client.releaseHold(SHIPMENT_ID);
    expect(released).toMatchObject({ status: "cancelled" });
    expect(clear).toHaveBeenCalledWith(SHIPMENT_ID);
    expect(spies.release).not.toHaveBeenCalled();
  });

  it("no escribe en la cuenta corriente por un envío simulado", async () => {
    const { client, spies } = build(true);
    const { entry, created } = await client.createLedgerEntry(CARRIER_ID, {
      idempotencyKey: "k-12345678",
      type: "cancellation_penalty",
      amountArs: 500,
      shipmentId: SHIPMENT_ID,
    });
    expect(created).toBe(false);
    expect(entry.amountArs).toBe(0);
    expect(spies.ledger).not.toHaveBeenCalled();
  });

  it("un envío sin marca va a payments tal cual", async () => {
    const { client, spies, clear } = build(false);
    await client.findHoldByShipment(SHIPMENT_ID);
    await client.releaseHold(SHIPMENT_ID);
    await client.findSettlement(SHIPMENT_ID);
    expect(spies.find).toHaveBeenCalled();
    expect(spies.release).toHaveBeenCalled();
    expect(spies.settlement).toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("createAppPaymentsClient arma el cliente real decorado (sin llamarse a sí mismo)", () => {
    const app = {
      db: {},
      config: {
        PAYMENTS_SERVICE_URL: "http://payments",
        USER_DEBT_OVERDUE_DAYS: 7,
      },
    } as unknown as FastifyInstance;
    const client = createAppPaymentsClient(app);
    expect(typeof client.findHoldByShipment).toBe("function");
    expect(typeof client.getCarrierMpAccountStatus).toBe("function");
  });
});
