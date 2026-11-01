import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { AuditTargetsRequest } from "@movo/shared";
import { createAdminOverviewRepository } from "../../repositories/admin-overview-repository";

const idList = { type: "array", maxItems: 100, items: { type: "string", format: "uuid" } } as const;

const auditTargetsBody = {
  type: "object",
  additionalProperties: false,
  required: ["disputes", "chatReports", "supportConversations"],
  properties: { disputes: idList, chatReports: idList, supportConversations: idList },
} as const;

/**
 * MOVO-342 (ADR-025): lecturas de este servicio para la home del panel y la bitácora. Internas, las consume `svc-admin`
 * (sin ruta en el gateway). Una ruta por bandeja: si una falla, solo esa tarjeta de la home queda con error.
 */
export default async function adminOverviewRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const repository = createAdminOverviewRepository(app.db);

  app.get("/admin/overview/disputes", { schema: { hide: true } }, async () => repository.disputes(new Date()));
  app.get("/admin/overview/support", { schema: { hide: true } }, async () => repository.support());
  app.get("/admin/overview/shipment-alerts", { schema: { hide: true } }, async () => repository.shipmentAlerts());
  app.get("/admin/overview/flagged-messages", { schema: { hide: true } }, async () => repository.flaggedMessages(new Date()));

  app.post("/admin/audit-targets", { schema: { hide: true, body: auditTargetsBody } }, async (request: FastifyRequest) =>
    repository.auditTargets(request.body as AuditTargetsRequest),
  );
}
