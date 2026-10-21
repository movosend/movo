import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { AdminCandidate, AdminSummary, ApiError } from "@movo/shared";
import { requireAdmin } from "../../utils/require-admin";
import { adminsSchemas, REVOKE_REASON_MIN_LENGTH } from "./admins.schema";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      return app.usersClient.listAdmins({ requestId: request.requestId });
    },
  );

  app.get(
    "/admins/candidates",
    {
      schema: {
        tags: ["admin"],
        summary: "Buscar usuarios por nombre o email para otorgar el rol admin",
        querystring: adminsSchemas.candidatesQuery,
        response: { 200: adminsSchemas.candidatesResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminCandidate[]> => {
      requireAdmin(request);
      const { q } = request.query as { q: string };
      if (q.trim().length < 2) return [];
      return app.usersClient.searchAdminCandidates(q.trim(), { requestId: request.requestId });
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
      // AJV valida el string crudo: un email de espacios llega vacío acá y no debe dejar fila.
      if (!EMAIL_PATTERN.test(email)) throw new ApiError(400, "VALIDATION_FAILED", "Ingresá un email válido.");
      const ctx = { requestId: request.requestId };
      // El usuario afectado se conoce recién cuando `svc-users` resuelve el email: si sale bien, la
      // fila queda con su id (igual que el revoke, así se filtra por usuario) y el email en el
      // contexto; si falla, el objetivo es el email. Otorgarse el rol a uno mismo es un no-op
      // idempotente, no un conflicto.
      return app.audit.runAdminAction<AdminSummary>(
        {
          adminId,
          action: "admin_role.grant",
          target: { type: "admin_role", id: email },
          context: { email },
          requestId: request.requestId,
          resolveTarget: (admin) => ({ type: "admin_role", id: admin.id }),
        },
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
      // AJV valida el string crudo: el mínimo se vuelve a exigir sobre el motivo ya sin espacios.
      if (reason.length < REVOKE_REASON_MIN_LENGTH)
        throw new ApiError(400, "VALIDATION_FAILED", `El motivo debe tener al menos ${REVOKE_REASON_MIN_LENGTH} caracteres.`);
      const ctx = { requestId: request.requestId };
      await app.audit.runAdminAction(
        { adminId, action: "admin_role.revoke", target: { type: "admin_role", id: userId }, reason, requestId: request.requestId },
        () => app.usersClient.revokeAdmin(userId, adminId, ctx),
      );
      reply.code(204);
    },
  );
}
