import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createAuditRepository } from "../modules/audit/audit.repository";
import { AuditService, createAuditService } from "../modules/audit/audit.service";
import { createConflictChecker } from "../modules/audit/conflict-of-interest";

/**
 * `app.audit`: un solo servicio de bitácora para todas las rutas de admin, que ejecutan sus
 * acciones con `app.audit.runAdminAction(...)`. Necesita la base y los clientes internos.
 */
export default fp(async (app: FastifyInstance) => {
  app.decorate(
    "audit",
    createAuditService({
      repository: createAuditRepository(app.db),
      conflictChecker: createConflictChecker({ usersClient: app.usersClient, shipmentsClient: app.shipmentsClient, supportClient: app.supportClient }),
      logger: app.log,
    }),
  );
});

declare module "fastify" {
  interface FastifyInstance {
    audit: AuditService;
  }
}
