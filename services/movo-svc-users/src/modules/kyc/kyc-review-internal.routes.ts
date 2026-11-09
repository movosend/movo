import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  ADMIN_KYC_DECISION_REASON_MAX_LENGTH,
  ADMIN_KYC_DECISION_REASON_MIN_LENGTH,
  ADMIN_KYC_REVIEW_DEFAULT_PAGE_SIZE,
  ADMIN_KYC_REVIEW_MAX_PAGE_SIZE,
  AdminKycDecisionResponse,
  AdminKycVerificationType,
  KycStatus,
} from "@movo/shared";
import { createDiditClient, DiditClient } from "../../adapters/didit-client";
import { createPushNotificationProvider, PushNotificationProvider } from "../../adapters/push-notification-provider";
import { createNotificationsService } from "../notifications/notifications.service";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createKycService } from "./kyc.service";
import { createKycReviewService } from "./kyc-review.service";

export interface KycReviewInternalRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración, mismo criterio que `KycRoutesOptions`. */
  diditClient?: DiditClient;
  pushProvider?: PushNotificationProvider;
}

const nullableString = { type: ["string", "null"] } as const;
const verificationType = { type: "string", enum: ["identity", "license"] } as const;

const errorResponse = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "statusCode"],
      properties: { code: { type: "string" }, message: { type: "string" }, statusCode: { type: "integer" } },
    },
    requestId: { type: "string" },
  },
} as const;
const errors = { 400: errorResponse, 404: errorResponse, 409: errorResponse, 502: errorResponse } as const;

const rowProperties = {
  sessionId: { type: "string" },
  userId: { type: "string" },
  fullName: { type: "string" },
  photoUrl: nullableString,
  verificationType,
  reason: nullableString,
  requestedAt: { type: "string" },
} as const;
const rowRequired = ["sessionId", "userId", "fullName", "photoUrl", "verificationType", "reason", "requestedAt"];

const sessionParam = {
  type: "object",
  required: ["sessionId"],
  properties: { sessionId: { type: "string", minLength: 1, maxLength: 128 } },
} as const;

const nStr = { type: ["string", "null"] } as const;
const nNum = { type: ["number", "null"] } as const;
const nBool = { type: ["boolean", "null"] } as const;
const obj = (properties: Record<string, unknown>, nullable = false) =>
  ({
    type: nullable ? ["object", "null"] : "object",
    required: Object.keys(properties),
    properties,
  }) as const;
const contact = { status: nStr, value: nStr, country: nStr, isDisposable: nBool, isVirtual: nBool };

const evidenceResponse = obj({
  fetchedAt: { type: "string" },
  imagesExpireAt: { type: "string" },
  sessionStatus: nStr,
  images: obj({ selfie: nStr, documentPortrait: nStr, documentFront: nStr, documentBack: nStr, livenessVideo: nStr }),
  document: obj(
    {
      status: nStr,
      type: nStr,
      number: nStr,
      personalNumber: nStr,
      firstName: nStr,
      lastName: nStr,
      fullName: nStr,
      dateOfBirth: nStr,
      age: nNum,
      gender: nStr,
      nationality: nStr,
      issuingCountry: nStr,
      issueDate: nStr,
      expirationDate: nStr,
      address: nStr,
      placeOfBirth: nStr,
      maritalStatus: nStr,
    },
    true
  ),
  faceMatch: obj({ status: nStr, score: nNum }, true),
  liveness: obj({ status: nStr, method: nStr, score: nNum }, true),
  ip: obj(
    {
      status: nStr,
      address: nStr,
      country: nStr,
      region: nStr,
      city: nStr,
      isVpnOrTor: nBool,
      isDataCenter: nBool,
      platform: nStr,
      browser: nStr,
      os: nStr,
      device: nStr,
    },
    true
  ),
  aml: obj({ status: nStr, totalHits: nNum, score: nNum }, true),
  phone: obj(contact, true),
  email: obj(contact, true),
  warnings: {
    type: "array",
    items: obj({ feature: { type: "string" }, risk: { type: "string" }, description: { type: "string" } }),
  },
  reviews: { type: "array", items: obj({ status: nStr, comment: nStr, createdAt: nStr }) },
});

const schemas = {
  list: {
    hide: true,
    querystring: {
      type: "object",
      properties: {
        type: verificationType,
        q: { type: "string", maxLength: 100, default: "" },
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: {
          type: "integer",
          minimum: 1,
          maximum: ADMIN_KYC_REVIEW_MAX_PAGE_SIZE,
          default: ADMIN_KYC_REVIEW_DEFAULT_PAGE_SIZE,
        },
      },
    },
    response: {
      200: {
        type: "object",
        required: ["items", "page", "pageSize", "total"],
        properties: {
          items: { type: "array", items: { type: "object", required: rowRequired, properties: rowProperties } },
          page: { type: "integer" },
          pageSize: { type: "integer" },
          total: { type: "integer" },
        },
      },
      400: errorResponse,
    },
  },
  detail: {
    hide: true,
    params: sessionParam,
    response: {
      200: {
        type: "object",
        required: [...rowRequired, "email", "phone", "expirationDate", "decidable", "history"],
        properties: {
          ...rowProperties,
          email: { type: "string" },
          phone: { type: "string" },
          expirationDate: nullableString,
          decidable: { type: "boolean" },
          history: {
            type: "array",
            items: {
              type: "object",
              required: ["sessionId", "status", "requestedAt", "resolvedAt", "reason"],
              properties: {
                sessionId: { type: "string" },
                status: { type: "string" },
                requestedAt: { type: "string" },
                resolvedAt: nullableString,
                reason: nullableString,
              },
            },
          },
        },
      },
      404: errorResponse,
    },
  },
  evidence: {
    hide: true,
    params: sessionParam,
    response: { 200: evidenceResponse, 404: errorResponse, 422: errorResponse, 502: errorResponse },
  },
  decision: {
    hide: true,
    params: sessionParam,
    body: {
      type: "object",
      required: ["decision", "reason"],
      additionalProperties: false,
      properties: {
        decision: { type: "string", enum: ["approved", "rejected"] },
        reason: {
          type: "string",
          minLength: ADMIN_KYC_DECISION_REASON_MIN_LENGTH,
          maxLength: ADMIN_KYC_DECISION_REASON_MAX_LENGTH,
        },
      },
    },
    response: {
      200: {
        type: "object",
        required: ["sessionId", "userId", "verificationType", "status"],
        properties: {
          sessionId: { type: "string" },
          userId: { type: "string" },
          verificationType,
          status: { type: "string", enum: ["approved", "rejected"] },
        },
      },
      ...errors,
    },
  },
} as const;

/**
 * Cola de revisión manual de KYC del panel. Interno (no se declara en el gateway): lo llama
 * `svc-admin`, que exige el rol admin, escribe la bitácora y aplica la idempotencia. En la
 * decisión `x-user-id` es el admin que la pidió: acá solo se loguea.
 */
export default async function kycReviewInternalRoutes(app: FastifyInstance, opts: KycReviewInternalRoutesOptions) {
  const diditClient = opts.diditClient ?? createDiditClient(app.config);
  const pushProvider = opts.pushProvider ?? createPushNotificationProvider(app.config);
  const notifications = createNotificationsService(app.db, pushProvider, app.log);
  const kycService = createKycService(app.db, diditClient, app.config.DIDIT_WEBHOOK_SECRET, app.log, notifications);
  const reviews = createKycReviewService(app.db, diditClient);

  const sessionIdOf = (request: FastifyRequest) => (request.params as { sessionId: string }).sessionId;

  app.get("/admin/kyc/reviews", { schema: schemas.list }, async (request: FastifyRequest) => {
    const { type, q, page, pageSize } = request.query as {
      type?: AdminKycVerificationType;
      q: string;
      page: number;
      pageSize: number;
    };
    return reviews.list({ type, q, page, pageSize });
  });

  app.get("/admin/kyc/reviews/:sessionId", { schema: schemas.detail }, async (request: FastifyRequest) =>
    reviews.detail(sessionIdOf(request))
  );

  // Datos del documento e imágenes de Didit: nunca en caché (los links de imagen son credenciales temporales).
  app.get("/admin/kyc/reviews/:sessionId/evidence", { schema: schemas.evidence }, async (request: FastifyRequest, reply) => {
    void reply.header("Cache-Control", "no-store");
    return reviews.evidence(sessionIdOf(request));
  });

  app.post(
    "/admin/kyc/reviews/:sessionId/decision",
    { schema: schemas.decision },
    async (request: FastifyRequest): Promise<AdminKycDecisionResponse> => {
      const adminId = requireUserIdFromHeader(request);
      const { decision, reason } = request.body as { decision: "approved" | "rejected"; reason: string };
      const resolved = await kycService.decideManualReview({
        externalSessionId: sessionIdOf(request),
        decision: decision === "approved" ? KycStatus.APPROVED : KycStatus.REJECTED,
        reason,
      });
      app.log.info(
        { adminId, externalSessionId: resolved.externalSessionId, decision, event: "kyc_review_decided_by_admin" },
        "decisión de KYC tomada desde el panel"
      );
      return {
        sessionId: resolved.externalSessionId,
        userId: resolved.userId,
        verificationType: resolved.verificationType,
        status: decision,
      };
    }
  );
}
