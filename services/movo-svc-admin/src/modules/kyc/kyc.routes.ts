import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  ADMIN_KYC_DECISION_REASON_MIN_LENGTH,
  AdminKycDecisionRequest,
  AdminKycDecisionResponse,
  AdminKycEvidence,
  AdminKycReviewDetail,
  AdminKycReviewPage,
  AdminKycVerificationType,
  ApiError,
} from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { requireAdmin } from "../../utils/require-admin";
import { requireReason } from "../users/user-names";
import { kycSchemas } from "./kyc.schema";

/**
 * Cola de revisión manual de KYC del panel. `svc-admin` orquesta: la regla de conflicto y la bitácora
 * (`runAdminAction`) y la decisión en `svc-users`, que se la pide a Didit y aplica el resultado. Las lecturas no
 * llevan bitácora. La cola solo lista intentos en `manual_review`.
 *
 * Sin idempotencia propia: la decisión ya es atómica en `svc-users` (solo se decide un intento en `manual_review`),
 * así que un doble clic o un reintento recibe 409 `KYC_REVIEW_STATUS_CHANGED` y no vuelve a llamar a Didit.
 */
export default async function kycRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const ctxOf = (request: FastifyRequest): RequestContext => ({ requestId: request.requestId });
  const sessionOf = (request: FastifyRequest) => (request.params as { sessionId: string }).sessionId;

  app.get(
    "/kyc/reviews",
    {
      schema: {
        tags: ["admin"],
        summary: "Cola de verificaciones de identidad o licencia que necesitan revisión manual (svc-users)",
        description: "Solo intentos en `manual_review`, el más viejo primero. 502 `USERS_SERVICE_UNAVAILABLE` si svc-users no responde.",
        ...kycSchemas.list,
      },
    },
    async (request): Promise<AdminKycReviewPage> => {
      requireAdmin(request);
      const { type, q, page, pageSize } = request.query as {
        type?: AdminKycVerificationType;
        q: string;
        page: number;
        pageSize: number;
      };
      return app.usersClient.listKycReviews({ type, q: q.trim(), page, pageSize }, ctxOf(request));
    },
  );

  app.get(
    "/kyc/reviews/:sessionId",
    {
      schema: {
        tags: ["admin"],
        summary: "Detalle de un caso de revisión de KYC (svc-users)",
        description: "También sirve un intento ya resuelto, con `decidable: false`. 404 `KYC_SESSION_NOT_FOUND`.",
        ...kycSchemas.detail,
      },
    },
    async (request): Promise<AdminKycReviewDetail> => {
      requireAdmin(request);
      return app.usersClient.getKycReview(sessionOf(request), ctxOf(request));
    },
  );

  app.get(
    "/kyc/reviews/:sessionId/evidence",
    {
      schema: {
        tags: ["admin"],
        summary: "Detalle que tiene Didit de la sesión: datos del documento, puntuaciones, IP, alertas e imágenes (svc-users)",
        description:
          "Se pide a Didit cada vez y no se guarda: las imágenes son links temporales que vencen a los 60 minutos, por eso la " +
          "respuesta no se cachea. Lectura, sin bitácora. 404 `KYC_SESSION_NOT_FOUND`; 422 `KYC_EVIDENCE_NOT_FOUND` si Didit no " +
          "conoce la sesión; 502 `KYC_PROVIDER_ERROR` si Didit no responde.",
        ...kycSchemas.evidence,
      },
    },
    async (request, reply): Promise<AdminKycEvidence> => {
      requireAdmin(request);
      void reply.header("Cache-Control", "no-store");
      return app.usersClient.getKycEvidence(sessionOf(request), ctxOf(request));
    },
  );

  app.post(
    "/kyc/reviews/:sessionId/decision",
    {
      schema: {
        tags: ["admin"],
        summary: "Aprobar o rechazar un caso en revisión manual de KYC",
        description:
          "Le pide a Didit el cambio de estado y aplica el resultado en svc-users (el usuario recibe el aviso). " +
          "409 `KYC_REVIEW_STATUS_CHANGED` si ya no está en revisión; 409 `KYC_REVIEW_SUPERSEDED` si el usuario abrió " +
          "una verificación más nueva; 502 `KYC_PROVIDER_ERROR` si Didit rechazó el pedido (no se aplicó nada). " +
          "Bitácora: `kyc.approve` / `kyc.decline`.",
        ...kycSchemas.decide,
      },
    },
    async (request): Promise<AdminKycDecisionResponse> => {
      const adminId = requireAdmin(request);
      const sessionId = sessionOf(request);
      const ctx = ctxOf(request);
      const raw = request.body as AdminKycDecisionRequest;
      const reason = requireReason(raw.reason);
      if ((raw.firstName === undefined) !== (raw.lastName === undefined)) {
        throw new ApiError(400, "VALIDATION_FAILED", "Mandá el nombre y el apellido juntos.");
      }
      if (raw.decision === "rejected" && raw.firstName !== undefined) {
        throw new ApiError(400, "VALIDATION_FAILED", "El nombre solo se corrige al aprobar.");
      }
      const name = raw.firstName !== undefined && raw.lastName !== undefined ? { firstName: raw.firstName, lastName: raw.lastName } : null;
      if (reason.length < ADMIN_KYC_DECISION_REASON_MIN_LENGTH) {
        throw new ApiError(400, "VALIDATION_FAILED", `El motivo necesita al menos ${ADMIN_KYC_DECISION_REASON_MIN_LENGTH} caracteres.`);
      }

      // El objetivo de la bitácora es el usuario: la regla de conflicto impide que un admin decida su propio KYC.
      // Un 404 acá no deja fila: no hay objetivo sobre el que registrar nada.
      const review = await app.usersClient.getKycReview(sessionId, ctx);

      return app.audit.runAdminAction(
        {
          adminId,
          action: raw.decision === "approved" ? "kyc.approve" : "kyc.decline",
          target: { type: "user", id: review.userId },
          reason,
          // Solo ids, el tipo y si el admin corrigió el nombre: nada de datos personales ni del documento en una bitácora
          // de solo agregar (el nombre en sí queda en la cuenta, no acá).
          context: { sessionId, verificationType: review.verificationType, ...(name ? { nameCorrected: true } : {}) },
          requestId: request.requestId,
        },
        () => app.usersClient.decideKycReview(sessionId, { decision: raw.decision, reason, ...(name ?? {}) }, adminId, ctx),
      );
    },
  );
}
