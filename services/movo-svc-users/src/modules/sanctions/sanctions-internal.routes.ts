import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import {
  AccountSanction,
  ACCOUNT_SANCTION_NOTE_MAX_LENGTH,
  ACCOUNT_SANCTION_REASON_MAX_LENGTH,
  ApplyAccountSanctionRequest,
  LiftAccountSanctionRequest,
} from "@movo/shared";
import { createEmailProvider, EmailProvider } from "../../adapters/email-provider";
import { createPushNotificationProvider, PushNotificationProvider } from "../../adapters/push-notification-provider";
import { createSessionRepository } from "../../repositories/session-repository";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createNotificationsService } from "../notifications/notifications.service";
import { createSanctionsService, SanctionsService } from "./sanctions.service";

export interface SanctionsInternalRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración, mismo criterio que `adminsInternalRoutes`. */
  emailProvider?: EmailProvider;
  pushProvider?: PushNotificationProvider;
}

// Autocontenido a propósito, mismo criterio que `admins-internal.routes.ts`.
const sanctionObject = {
  type: "object",
  required: [
    "id",
    "userId",
    "type",
    "reason",
    "internalNote",
    "startedAt",
    "endsAt",
    "appliedBy",
    "liftedAt",
    "liftedBy",
    "liftReason",
    "closedCause",
  ],
  properties: {
    id: { type: "string" },
    userId: { type: "string" },
    type: { type: "string", enum: ["suspension", "disable"] },
    reason: { type: "string" },
    internalNote: { type: ["string", "null"] },
    startedAt: { type: "string" },
    endsAt: { type: ["string", "null"] },
    appliedBy: { type: ["string", "null"] },
    liftedAt: { type: ["string", "null"] },
    liftedBy: { type: ["string", "null"] },
    liftReason: { type: ["string", "null"] },
    closedCause: { type: ["string", "null"], enum: ["lifted", "replaced", "escalated", "expired", null] },
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

const userIdParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};

const sanctionSchemas = {
  apply: {
    hide: true,
    params: userIdParams,
    body: {
      type: "object",
      required: ["type", "reason"],
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["suspension", "disable"] },
        reason: { type: "string", minLength: 1, maxLength: ACCOUNT_SANCTION_REASON_MAX_LENGTH },
        internalNote: { type: "string", maxLength: ACCOUNT_SANCTION_NOTE_MAX_LENGTH },
        endsAt: { type: "string", format: "date-time" },
      },
    },
    response: { 201: sanctionObject, 400: errorResponse, 404: errorResponse, 409: errorResponse },
  },
  lift: {
    hide: true,
    params: {
      type: "object",
      required: ["id", "sanctionId"],
      properties: { id: { type: "string", format: "uuid" }, sanctionId: { type: "string", format: "uuid" } },
    },
    body: {
      type: "object",
      required: ["reason"],
      additionalProperties: false,
      properties: { reason: { type: "string", minLength: 1, maxLength: ACCOUNT_SANCTION_REASON_MAX_LENGTH } },
    },
    response: { 200: sanctionObject, 400: errorResponse, 404: errorResponse, 409: errorResponse },
  },
  list: {
    hide: true,
    params: userIdParams,
    response: { 200: { type: "array", items: sanctionObject }, 404: errorResponse },
  },
};

/** Arma el servicio con los proveedores reales (o los overrides de test). Lo usan las rutas y el barrido. */
export function buildSanctionsService(
  app: FastifyInstance,
  overrides: { emailProvider?: EmailProvider | undefined; pushProvider?: PushNotificationProvider | undefined } = {}
): SanctionsService {
  const pushProvider = overrides.pushProvider ?? createPushNotificationProvider(app.config);
  return createSanctionsService({
    db: app.db,
    redis: app.redis,
    sessionRepository: createSessionRepository(app.redis),
    notifications: createNotificationsService(app.db, pushProvider, app.log),
    emailProvider: overrides.emailProvider ?? createEmailProvider(app.config),
    logger: app.log,
  });
}

/**
 * MOVO-296: sanciones de cuenta para `svc-admin`. Internas (`hide: true`, sin ruta en el
 * gateway), mismo criterio que `adminsInternalRoutes`; el id del admin que sanciona llega en
 * `x-user-id`.
 */
export default async function sanctionsInternalRoutes(app: FastifyInstance, opts: SanctionsInternalRoutesOptions) {
  const service = buildSanctionsService(app, { emailProvider: opts.emailProvider, pushProvider: opts.pushProvider });

  app.post(
    "/users/:id/sanctions",
    { schema: sanctionSchemas.apply },
    async (request: FastifyRequest, reply: FastifyReply): Promise<AccountSanction> => {
      const adminId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const sanction = await service.applySanction(id, request.body as ApplyAccountSanctionRequest, adminId);
      reply.code(201);
      return sanction;
    }
  );

  app.post(
    "/users/:id/sanctions/:sanctionId/lift",
    { schema: sanctionSchemas.lift },
    async (request: FastifyRequest): Promise<AccountSanction> => {
      const adminId = requireUserIdFromHeader(request);
      const { id, sanctionId } = request.params as { id: string; sanctionId: string };
      return service.liftSanction(id, sanctionId, request.body as LiftAccountSanctionRequest, adminId);
    }
  );

  app.get("/users/:id/sanctions", { schema: sanctionSchemas.list }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    return service.listSanctions(id);
  });
}
