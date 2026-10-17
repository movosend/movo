import type { FastifyInstance } from "fastify";

/** Resúmenes mínimos para los movimientos de cuenta corriente. Solo red interna. */
export default async function ledgerOriginsRoutes(app: FastifyInstance) {
  app.post("/ledger-origins", {
    schema: {
      hide: true,
      body: { type: "object", required: ["userId", "shipmentIds"], additionalProperties: false, properties: {
        userId: { type: "string", format: "uuid" },
        shipmentIds: { type: "array", maxItems: 50, items: { type: "string", format: "uuid" } },
      } },
    },
  }, async (request) => {
    const { userId, shipmentIds } = request.body as { userId: string; shipmentIds: string[] };
    const rows = await app.db.shipment.findMany({ where: { id: { in: shipmentIds }, OR: [{ senderId: userId }, { carrierId: userId }, { receiverId: userId }] }, select: { id: true, deliveryAddress: true } });
    return rows.map((row) => ({ id: row.id, label: `Envío a ${row.deliveryAddress.split(",").at(-1)?.trim() || "destino"} #${row.id.slice(0, 8)}` }));
  });
}
