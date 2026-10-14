import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { AdminSummary } from "@movo/shared";
import { createEmailProvider, EmailProvider } from "../../adapters/email-provider";
import { createSessionRepository } from "../../repositories/session-repository";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createAdminRolesService } from "./admin-roles.service";

export interface AdminsInternalRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración, mismo criterio que en `authRoutes`. */
  emailProvider?: EmailProvider;
}

// Autocontenido a propósito, mismo criterio que `kyc-internal.routes.ts`.
const adminSummary = {
  type: "object",
  required: ["id", "fullName", "email", "grantedAt"],
  properties: {
    id: { type: "string" },
    fullName: { type: "string" },
    email: { type: "string" },
    grantedAt: { type: "string" },
  },
};

const errorResponse = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "statusCode"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        statusCode: { type: "integer" },
      },
    },
    requestId: { type: "string" },
  },
};

const adminsInternalSchemas = {
  list: {
    hide: true,
    response: {
      200: { type: "array", items: adminSummary },
    },
  },
  grant: {
    hide: true,
    body: {
      type: "object",
      required: ["email"],
      additionalProperties: false,
      properties: {
        email: { type: "string", minLength: 3, maxLength: 254 },
      },
    },
    response: {
      200: adminSummary,
      201: adminSummary,
      401: errorResponse,
      404: errorResponse,
      409: errorResponse,
      422: errorResponse,
    },
  },
  revoke: {
    hide: true,
    params: {
      type: "object",
      required: ["userId"],
      properties: {
        userId: { type: "string", format: "uuid" },
      },
    },
    response: {
      401: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  },
};

/**
 * MOVO-290: alta y baja del rol `admin`. Interno: no se declara en
 * `gateway/src/config/routes-map.ts`, así que solo se alcanza desde la red Docker. Lo llama
 * `svc-admin` (MOVO-292), que aplica la regla de "no revocarse a uno mismo" y escribe la
 * bitácora. `x-user-id` es el admin que pidió la operación (AC6): acá solo se loguea.
 */
export default async function adminsInternalRoutes(app: FastifyInstance, opts: AdminsInternalRoutesOptions) {
  const service = createAdminRolesService({
    db: app.db,
    sessionRepository: createSessionRepository(app.redis),
    emailProvider: opts.emailProvider ?? createEmailProvider(app.config),
    logger: app.log,
  });

  app.get("/admins", { schema: adminsInternalSchemas.list }, async (): Promise<AdminSummary[]> => {
    return service.listAdmins();
  });

  app.post(
    "/admins",
    { schema: adminsInternalSchemas.grant },
    async (request: FastifyRequest, reply: FastifyReply): Promise<AdminSummary> => {
      const requestedBy = requireUserIdFromHeader(request);
      const { email } = request.body as { email: string };
      const { admin, alreadyAdmin } = await service.grantAdmin(email, requestedBy);
      reply.code(alreadyAdmin ? 200 : 201);
      return admin;
    }
  );

  app.delete(
    "/admins/:userId",
    { schema: adminsInternalSchemas.revoke },
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const requestedBy = requireUserIdFromHeader(request);
      const { userId } = request.params as { userId: string };
      await service.revokeAdmin(userId, requestedBy);
      reply.code(204);
    }
  );
}
