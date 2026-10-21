import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { createEmailProvider, EmailProvider } from "../../adapters/email-provider";
import { createSessionRepository } from "../../repositories/session-repository";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { AdminContactUpdateInput, createAdminUsersService } from "./admin-users.service";
import { adminUsersSchemas } from "./admin-users.schema";

export interface AdminUsersInternalRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración, mismo criterio que `adminsInternalRoutes`. */
  emailProvider?: EmailProvider;
}

/**
 * MOVO-294: búsqueda de usuarios, ficha del panel y acciones de soporte sobre la cuenta. Interno
 * (no se declara en `gateway/src/config/routes-map.ts`): lo llama `svc-admin`, que exige el rol
 * admin, aplica la regla de conflicto y escribe la bitácora. En las escrituras `x-user-id` es el
 * admin que pidió la operación: acá solo se loguea.
 */
export default async function adminUsersInternalRoutes(app: FastifyInstance, opts: AdminUsersInternalRoutesOptions) {
  const service = createAdminUsersService({
    db: app.db,
    sessionRepository: createSessionRepository(app.redis),
    emailProvider: opts.emailProvider ?? createEmailProvider(app.config),
    logger: app.log,
  });

  const idOf = (request: FastifyRequest) => (request.params as { id: string }).id;

  app.get("/admin/users", { schema: adminUsersSchemas.search }, async (request: FastifyRequest) => {
    const { q, page, pageSize } = request.query as { q: string; page: number; pageSize: number };
    return service.search(q, page, pageSize);
  });

  // Ruta estática antes de las de `/:id` (el router ya lo resuelve, es por legibilidad).
  app.post("/admin/users/names", { schema: adminUsersSchemas.names }, async (request: FastifyRequest) => {
    const { ids } = request.body as { ids: string[] };
    return { users: await service.getNames(ids) };
  });

  app.get("/admin/users/:id", { schema: adminUsersSchemas.profile }, async (request) => service.getProfile(idOf(request)));
  app.get("/admin/users/:id/kyc", { schema: adminUsersSchemas.kyc }, async (request) => service.getKyc(idOf(request)));
  app.get("/admin/users/:id/vehicle", { schema: adminUsersSchemas.vehicle }, async (request) => service.getVehicle(idOf(request)));
  app.get("/admin/users/:id/moderation", { schema: adminUsersSchemas.moderation }, async (request) => service.getModeration(idOf(request)));
  app.get("/admin/users/:id/devices", { schema: adminUsersSchemas.devices }, async (request) => service.getDevices(idOf(request)));

  app.post("/admin/users/:id/sessions/revoke", { schema: adminUsersSchemas.revokeSessions }, async (request: FastifyRequest) => {
    const requestedBy = requireUserIdFromHeader(request);
    return service.revokeAllSessions(idOf(request), requestedBy);
  });

  app.post("/admin/users/:id/contact", { schema: adminUsersSchemas.updateContact }, async (request: FastifyRequest) => {
    const requestedBy = requireUserIdFromHeader(request);
    return service.updateContact(idOf(request), request.body as AdminContactUpdateInput, requestedBy);
  });
}
