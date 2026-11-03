import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import {
  createAppPaymentsClient,
  withSimulatedPayments,
} from "../src/adapters/simulated-payments-client";
import type { PaymentSimulation } from "../src/repositories/shipment-repository";
import { createFakePaymentsClient } from "./fake-payments-client";

const SHIPMENT_ID = "11111111-1111-4111-8111-111111111111";
const CARRIER_ID = "22222222-2222-4222-8222-222222222222";

function build(simulation: Partial<PaymentSimulation> | null) {
  const inner = createFakePaymentsClient();
  const spies = {
    find: vi.spyOn(inner, "findHoldByShipment"),
    release: vi.spyOn(inner, "releaseHold"),
    capture: vi.spyOn(inner, "captureHold"),
    settlement: vi.spyOn(inner, "findSettlement"),
    ledger: vi.spyOn(inner, "createLedgerEntry"),
  };
  const lookup = vi.fn(async () =>
    simulation === null
      ? null
      : {
          simulated: true,
          status: ShipmentStatus.ASSIGNED,
          carrierId: CARRIER_ID,
          ...simulation,
        },
  );
  return { client: withSimulatedPayments(inner, lookup), spies, lookup };
}

const penalty = {
  idempotencyKey: "k-12345678",
  type: "cancellation_penalty" as const,
  amountArs: 500,
  shipmentId: SHIPMENT_ID,
};

describe("withSimulatedPayments (DD-055)", () => {
  it("un envío simulado asignado responde con un hold autorizado sin llamar a payments", async () => {
    const { client, spies } = build({});
    const hold = await client.findHoldByShipment(SHIPMENT_ID, { sync: true });
    expect(hold).toMatchObject({
      status: "authorized",
      shipmentId: SHIPMENT_ID,
      carrierId: CARRIER_ID,
      amountArs: 0,
    });
    expect(spies.find).not.toHaveBeenCalled();
  });

  it("una sola lectura por llamada (id, estado y transportista juntos)", async () => {
    const { client, lookup } = build({});
    await client.findHoldByShipment(SHIPMENT_ID);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("captura una liquidación acreditada en $0 una vez entregado", async () => {
    const { client, spies } = build({ status: ShipmentStatus.DELIVERED });
    expect(await client.captureHold(SHIPMENT_ID)).toMatchObject({
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

  it("no hay liquidación antes de la entrega, como en el cliente real (comentario 5)", async () => {
    for (const status of [ShipmentStatus.ASSIGNED, ShipmentStatus.IN_TRANSIT]) {
      const { client, spies } = build({ status });
      expect(await client.findSettlement(SHIPMENT_ID)).toBeNull();
      expect(spies.settlement).not.toHaveBeenCalled();
    }
  });

  it("liberar el hold sintético no desmarca nada: la marca solo cambia con la asignación (comentarios 1 y 4)", async () => {
    const { client, spies } = build({});
    expect(await client.releaseHold(SHIPMENT_ID)).toMatchObject({
      status: "cancelled",
    });
    expect(
      await client.releaseHold(SHIPMENT_ID, CARRIER_ID, SHIPMENT_ID),
    ).toMatchObject({ status: "cancelled" });
    expect(spies.release).not.toHaveBeenCalled();
    // Tras liberar sigue simulado: una penalidad de la baja no cae en el ledger real.
    const { entry, created } = await client.createLedgerEntry(
      CARRIER_ID,
      penalty,
    );
    expect(created).toBe(false);
    expect(entry.amountArs).toBe(0);
  });

  it("un hold REAL (otro id) se libera en payments, aunque el envío esté simulado (comentario 2)", async () => {
    const { client, spies } = build({});
    await client.releaseHold(
      SHIPMENT_ID,
      CARRIER_ID,
      "99999999-9999-4999-8999-999999999999",
    );
    expect(spies.release).toHaveBeenCalledWith(
      SHIPMENT_ID,
      CARRIER_ID,
      "99999999-9999-4999-8999-999999999999",
    );
  });

  it("el ledger usa la marca cruda: una baja que ya volvió a published tampoco escribe deuda (comentario 4)", async () => {
    const { client, spies } = build({
      status: ShipmentStatus.PUBLISHED,
      carrierId: null,
    });
    expect((await client.createLedgerEntry(CARRIER_ID, penalty)).created).toBe(
      false,
    );
    expect(spies.ledger).not.toHaveBeenCalled();
  });

  it("vuelto a published deja de contestar lo sintético: el próximo emisor no ve un hold que nunca pagó", async () => {
    for (const status of [
      ShipmentStatus.PUBLISHED,
      ShipmentStatus.ASSIGNMENT_PENDING,
      ShipmentStatus.ASSIGNED_UNFUNDED,
    ]) {
      const { client, spies } = build({ status, carrierId: null });
      await client.findHoldByShipment(SHIPMENT_ID);
      expect(spies.find).toHaveBeenCalledTimes(1);
    }
  });

  it("sin transportista en un envío simulado activo falla con un error claro, no con un id vacío (comentario 9)", async () => {
    const { client } = build({ carrierId: null });
    await expect(client.captureHold(SHIPMENT_ID)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("un envío sin marca (o inexistente) va a payments tal cual", async () => {
    for (const simulation of [{ simulated: false }, null]) {
      const { client, spies } = build(simulation);
      await client.findHoldByShipment(SHIPMENT_ID);
      await client.releaseHold(SHIPMENT_ID);
      await client.findSettlement(SHIPMENT_ID);
      await client.createLedgerEntry(CARRIER_ID, penalty);
      expect(spies.find).toHaveBeenCalled();
      expect(spies.release).toHaveBeenCalled();
      expect(spies.settlement).toHaveBeenCalled();
      expect(spies.ledger).toHaveBeenCalled();
    }
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
