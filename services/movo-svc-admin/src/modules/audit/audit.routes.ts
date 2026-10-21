import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { AdminTargetType, AuditLogPage } from "@movo/shared";
import { requireAdmin } from "../../utils/require-admin";
import { auditSchemas } from "./audit.schema";

interface AuditLogQuery {
  adminId?: string;
  action?: string;
  targetType?: AdminTargetType;
  targetId?: string;
  limit: number;
  cursor?: string;
}

/** MOVO-288 AC7: lectura de la bitácora. La lee cualquier admin; no es una escritura. */
export default async function auditRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get(
    "/audit-log",
    {
      schema: {
        tags: ["admin"],
        summary: "Bitácora de acciones del panel, de la más reciente a la más vieja",
        querystring: auditSchemas.listQuery,
        response: {
          200: auditSchemas.listResponse,
          400: auditSchemas.errorResponse,
          401: auditSchemas.errorResponse,
          403: auditSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest): Promise<AuditLogPage> => {
      requireAdmin(request);
      const { limit, cursor, ...filters } = request.query as AuditLogQuery;
      return app.audit.list(filters, limit, cursor);
    },
  );
}
