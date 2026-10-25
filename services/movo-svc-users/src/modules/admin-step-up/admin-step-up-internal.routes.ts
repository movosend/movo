import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { StepUpChallenge, StepUpToken } from "@movo/shared";
import { createEmailProvider, EmailProvider } from "../../adapters/email-provider";
import { createSmsProvider, SmsProvider } from "../../adapters/sms-provider";
import { createOtpRepository } from "../../repositories/otp-repository";
import { createUserRepository } from "../../repositories/user-repository";
import { createOtpService } from "../../services/otp-service";
import { AdminStepUpService, createAdminStepUpService, StepUpAction } from "./admin-step-up.service";

export interface AdminStepUpInternalRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración, mismo criterio que en `authRoutes`. */
  emailProvider?: EmailProvider;
  smsProvider?: SmsProvider;
}

// Autocontenido a propósito, mismo criterio que `admins-internal.routes.ts`.
const uuid = { type: "string", format: "uuid" } as const;
const SHIPMENT_STATUSES = [
  "awaiting_receiver_confirmation",
  "rejected_by_receiver",
  "published",
  "assignment_pending",
  "assigned_unfunded",
  "assigned",
  "in_transit",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
] as const;
const actionProperties = {
  adminId: uuid,
  shipmentId: uuid,
  targetStatus: { type: "string", enum: SHIPMENT_STATUSES },
} as const;
const body = (extra: Record<string, unknown> = {}) => ({
  type: "object",
  additionalProperties: false,
  required: ["adminId", "shipmentId", "targetStatus", ...Object.keys(extra)],
  properties: { ...actionProperties, ...extra },
});

/**
 * MOVO-332 (DD-055): segundo factor por acción del panel. Interno (solo red Docker, ADR-010): lo
 * llama `svc-admin`, que ya validó la sesión y pasa el `adminId`. No se declara en el routes-map del gateway.
 */
export default async function adminStepUpInternalRoutes(app: FastifyInstance, opts: AdminStepUpInternalRoutesOptions) {
  const otpService = createOtpService(createOtpRepository(app.redis), {
    sms: opts.smsProvider ?? createSmsProvider(app.config),
    email: opts.emailProvider ?? createEmailProvider(app.config),
  });
  const service: AdminStepUpService = createAdminStepUpService({
    redis: app.redis,
    otpService,
    userRepository: createUserRepository(app.db),
  });

  app.post(
    "/admin/step-up/request",
    { schema: { hide: true, body: body() } },
    async (request: FastifyRequest): Promise<StepUpChallenge> => service.request(request.body as StepUpAction),
  );

  app.post(
    "/admin/step-up/verify",
    {
      schema: {
        hide: true,
        body: body({
          challengeId: { type: "string", minLength: 1, maxLength: 128 },
          code: { type: "string", pattern: "^[0-9]{6}$" },
        }),
      },
    },
    async (request: FastifyRequest): Promise<StepUpToken> =>
      service.verify(request.body as StepUpAction & { challengeId: string; code: string }),
  );

  app.post(
    "/admin/step-up/validate",
    {
      schema: {
        hide: true,
        body: body({ stepUpToken: { type: "string", minLength: 20, maxLength: 128 } }),
        response: { 204: { type: "null" } },
      },
    },
    async (request: FastifyRequest, reply) => {
      await service.validate(request.body as StepUpAction & { stepUpToken: string });
      reply.code(204);
    },
  );

  app.post(
    "/admin/step-up/consume",
    {
      schema: {
        hide: true,
        body: body({ stepUpToken: { type: "string", minLength: 20, maxLength: 128 } }),
        response: { 204: { type: "null" } },
      },
    },
    async (request: FastifyRequest, reply) => {
      await service.consume(request.body as StepUpAction & { stepUpToken: string });
      reply.code(204);
    },
  );
}
