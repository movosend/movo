import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { AdminSummary, ApiError } from "@movo/shared";
import { requireAdmin } from "../../utils/require-admin";
import { adminsSchemas } from "./admins.schema";

/**
 * MOVO-292: gestión de admins desde el panel. `svc-users` es el dueño del rol (endpoints internos
 * de MOVO-290); acá se aplica la regla de conflicto (nadie se revoca a sí mismo) y la bitácora,
 * ambas por `app.audit.runAdminAction`. Los rechazos de `svc-users` (email sin verificar, último
 * admin, usuario inexistente) se relanzan con su código y mensaje para que el panel los muestre.
 */
export default async function adminsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const errors = {
    400: adminsSchemas.errorResponse,
    401: adminsSchemas.errorResponse,
    403: adminsSchemas.errorResponse,
    404: adminsSchemas.errorResponse,
    409: adminsSchemas.errorResponse,
    422: adminsSchemas.errorResponse,
    502: adminsSchemas.errorResponse,
  };

  app.get(
    "/admins",
    {
      schema: {
        tags: ["admin"],
        summary: "Usuarios con el rol admin",
        response: { 200: adminsSchemas.listResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminSummary[]> => {
      requireAdmin(request);
      return app.usersClient.listAdmins({ requestId: request.id });
    },
  );

  app.post(
    "/admins",
    {
      schema: {
        tags: ["admin"],
        summary: "Otorgar el rol admin por email (idempotente)",
        body: adminsSchemas.grantBody,
        response: { 200: adminsSchemas.adminSummary, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminSummary> => {
      const adminId = requireAdmin(request);
      const email = (request.body as { email: string }).email.trim().toLowerCase();
      const ctx = { requestId: request.id };
      // El usuario afectado se conoce recién cuando `svc-users` resuelve el email, así que el
      // objetivo de la bitácora es el email; el id queda en la respuesta. Otorgarse el rol a uno
      // mismo es un no-op idempotente, no un conflicto.
      return app.audit.runAdminAction(
        { adminId, action: "admin_role.grant", target: { type: "admin_role", id: email }, requestId: request.id },
        () => app.usersClient.grantAdmin(email, adminId, ctx),
      );
    },
  );

  app.delete(
    "/admins/:userId",
    {
      schema: {
        tags: ["admin"],
        summary: "Revocar el rol admin (exige motivo; no sobre uno mismo)",
        params: adminsSchemas.revokeParams,
        body: adminsSchemas.revokeBody,
        response: { 204: { type: "null" }, ...errors },
      },
    },
    async (request: FastifyRequest, reply): Promise<void> => {
      const adminId = requireAdmin(request);
      const { userId } = request.params as { userId: string };
      const reason = (request.body as { reason: string }).reason.trim();
      if (!reason) throw new ApiError(400, "VALIDATION_FAILED", "Indicá el motivo de la revocación.");
      const ctx = { requestId: request.id };
      await app.audit.runAdminAction(
        { adminId, action: "admin_role.revoke", target: { type: "admin_role", id: userId }, reason, requestId: request.id },
        () => app.usersClient.revokeAdmin(userId, adminId, ctx),
      );
      reply.code(204);
    },
  );
}
