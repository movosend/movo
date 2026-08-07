import { FastifyBaseLogger } from "fastify";
import { ApiError, KycStatus } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";
import { createKycVerificationRepository } from "../../repositories/kyc-verification-repository";
import { DiditClient, mapDiditStatusToKycStatus } from "../../adapters/didit-client";
import { verifyDiditSignature } from "../../adapters/didit-signature";

/** Estados desde los que se puede pedir una sesión nueva (AC2). `pending` queda afuera
 * a propósito — un intento en curso no se reintenta ni devuelve, se rechaza (409). */
const ALLOWED_SESSION_SOURCE_STATUSES: ReadonlySet<KycStatus> = new Set([
  KycStatus.NOT_STARTED,
  KycStatus.REJECTED,
  KycStatus.MANUAL_REVIEW,
]);

export interface CreateKycSessionResult {
  sessionId: string;
  sessionToken: string;
}

export interface KycStatusResult {
  status: KycStatus;
  manualReviewReason: string | null;
}

/**
 * Payload del webhook de Didit.me tal cual llega. Shape confirmado contra el sandbox
 * real (MOVO-72, Paso 7) vía "Probar Webhook" de la consola, para los 3 escenarios
 * terminales (`Approved`/`Declined`/`In Review`): `status`/`session_id`/`vendor_data`/
 * `workflow_id`/`webhook_type` viven en el nivel superior; `decision` es un objeto
 * enorme (~20KB) con el detalle de cada feature (OCR, NFC, AML, liveness, cuestionario,
 * IP, etc.) — incluye imágenes de documento, domicilio, fecha de nacimiento y otros
 * datos que AC9 prohíbe persistir. No se tipa `decision` en detalle a propósito: el
 * resto del código no debe tocarlo directamente, solo a través de
 * `extractDecisionWarnings`.
 *
 * **No hay un campo `reason` de nivel superior.** `decision.reviews` tampoco sirve
 * (queda vacío incluso en el payload real de ejemplo de `In Review` — se completa
 * recién cuando un humano termina una revisión manual en el back-office de Didit,
 * después de este webhook, no en el momento de la transición). El motivo real vive
 * disperso en `decision.<feature>[].warnings[]` (confirmado con un payload real de
 * `Declined`: `decision.id_verifications[0].warnings[0]` trae
 * `{feature, risk: "DOCUMENT_EXPIRED", short_description: "Document expired", ...}`) —
 * ver `extractDecisionWarnings`.
 */
export interface DiditWebhookPayload {
  status?: string;
  session_id?: string;
  vendor_data?: string;
  workflow_id?: string;
  webhook_type?: string;
  decision?: unknown;
  [key: string]: unknown;
}

interface DecisionWarning {
  feature: string;
  risk: string;
  description: string;
}

/**
 * Recorre genéricamente las arrays de `decision` (`id_verifications`, `face_matches`,
 * `aml_screenings`, etc. — no se listan a mano: son ~11 y Didit puede agregar más) y
 * junta los `warnings[]` de cada item. Solo extrae `feature`/`risk`/`short_description`
 * — nunca `long_description` (más texto libre, menos revisado) ni ningún otro campo del
 * item que lo contiene (que sí puede traer PII, como `id_verifications[].address`).
 * Devuelve `[]` si `decision` falta o no tiene la forma esperada — nunca tira.
 */
function extractDecisionWarnings(decision: unknown): DecisionWarning[] {
  if (!decision || typeof decision !== "object") {
    return [];
  }

  const warnings: DecisionWarning[] = [];
  for (const featureResult of Object.values(decision as Record<string, unknown>)) {
    if (!Array.isArray(featureResult)) {
      continue;
    }
    for (const item of featureResult) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const itemWarnings = (item as Record<string, unknown>)["warnings"];
      if (!Array.isArray(itemWarnings)) {
        continue;
      }
      for (const warning of itemWarnings) {
        if (!warning || typeof warning !== "object") {
          continue;
        }
        const { feature, risk, short_description: description } = warning as Record<string, unknown>;
        if (typeof feature === "string" && typeof risk === "string" && typeof description === "string") {
          warnings.push({ feature, risk, description });
        }
      }
    }
  }
  return warnings;
}

/**
 * Whitelist explícita de campos "seguros" del payload del webhook (AC9: Movo no
 * persiste imágenes de documentos ni datos biométricos). Se arma campo por campo en vez
 * de guardar el payload completo, para que un campo nuevo que Didit agregue mañana
 * (ej. una URL de foto) no se cuele por default — en particular, `payload.decision`
 * nunca se copia tal cual, solo se le pasa a `extractDecisionWarnings`.
 */
function buildRedactedRawDecision(payload: DiditWebhookPayload): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  if (typeof payload.status === "string") redacted["status"] = payload.status;
  if (typeof payload.session_id === "string") redacted["session_id"] = payload.session_id;
  if (typeof payload.vendor_data === "string") redacted["vendor_data"] = payload.vendor_data;
  const warnings = extractDecisionWarnings(payload.decision);
  if (warnings.length > 0) redacted["warnings"] = warnings;
  return redacted;
}

export function createKycService(
  db: PrismaClient,
  diditClient: DiditClient,
  webhookSecret: string | undefined,
  logger: FastifyBaseLogger
) {
  const userRepository = createUserRepository(db);
  const kycVerificationRepository = createKycVerificationRepository(db);

  return {
    async createSession(userId: string): Promise<CreateKycSessionResult> {
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
      }
      if (!user.phoneVerified) {
        throw new ApiError(409, "KYC_SESSION_NOT_ALLOWED", "El teléfono todavía no fue verificado.");
      }
      if (!ALLOWED_SESSION_SOURCE_STATUSES.has(user.kycStatusIdentity)) {
        throw new ApiError(
          409,
          "KYC_SESSION_NOT_ALLOWED",
          "El estado de verificación actual no permite crear una nueva sesión."
        );
      }

      const session = await diditClient.createSession({ vendorData: userId });

      // Ambas escrituras (el intento nuevo + el caché en `users`) en una sola
      // transacción -- evita que queden desincronizadas si algo falla a mitad de camino.
      await db.$transaction(async (tx) => {
        const txKycVerificationRepository = createKycVerificationRepository(tx);
        const txUserRepository = createUserRepository(tx);
        await txKycVerificationRepository.create({
          userId,
          verificationType: "identity",
          provider: "didit",
          externalSessionId: session.sessionId,
          status: KycStatus.PENDING,
        });
        await txUserRepository.updateKycStatusIdentity(userId, KycStatus.PENDING);
      });

      // AC11: registro estructurado del evento (pino, ya activo en Fastify::app.log).
      logger.info({ userId, sessionId: session.sessionId, event: "kyc_session_created" }, "KYC session created");

      return { sessionId: session.sessionId, sessionToken: session.sessionToken };
    },

    async handleWebhook(
      rawBody: Buffer,
      signatureHeader: string | string[] | undefined,
      timestampHeader: string | string[] | undefined,
      payload: DiditWebhookPayload
    ): Promise<void> {
      if (!webhookSecret) {
        // No debería poder pasar (createDiditClient ya exige DIDIT_WEBHOOK_SECRET
        // cuando DIDIT_MODE=live) -- red de seguridad para no validar contra un
        // secreto vacío si algún día ese invariante se rompe.
        throw new ApiError(401, "KYC_WEBHOOK_INVALID_SIGNATURE", "Webhook de KYC no configurado.");
      }
      verifyDiditSignature(rawBody, signatureHeader, timestampHeader, webhookSecret);

      const rawStatus = payload.status;
      const externalSessionId = payload.session_id;
      if (!rawStatus || !externalSessionId) {
        logger.warn({ payload }, "kyc webhook ignorado: falta status o session_id");
        return;
      }

      const targetStatus = mapDiditStatusToKycStatus(rawStatus);
      if (targetStatus === null) {
        // Estado no terminal (Not Started/In Progress/Awaiting User/Resubmitted) o uno
        // de los estados sin mapeo confirmado todavía (Expired/Abandoned/Kyc Expired,
        // ver Paso 7 del plan) -- no dispara ninguna transición.
        logger.info({ externalSessionId, rawStatus }, "kyc webhook ignorado: estado no terminal");
        return;
      }

      const rawDecision = buildRedactedRawDecision(payload);

      // Idempotencia (AC7): resolveByExternalSessionId solo aplica la transición si el
      // intento seguía en `pending` -- un webhook duplicado, o fuera de orden, devuelve
      // `null` acá y no se toca nada más.
      const resolved = await db.$transaction(async (tx) => {
        const txKycVerificationRepository = createKycVerificationRepository(tx);
        const result = await txKycVerificationRepository.resolveByExternalSessionId({
          externalSessionId,
          fromStatus: KycStatus.PENDING,
          toStatus: targetStatus,
          rawDecision,
        });
        if (result) {
          const txUserRepository = createUserRepository(tx);
          await txUserRepository.updateKycStatusIdentity(result.userId, targetStatus);
        }
        return result;
      });

      if (!resolved) {
        logger.info({ externalSessionId, rawStatus }, "kyc webhook ignorado: duplicado o sesión desconocida (AC7)");
        return;
      }

      // AC6/AC11: timestamp e identificador de sesión ya quedaron persistidos en
      // `kyc_verification` (resolvedAt/externalSessionId) -- esto es además el registro
      // estructurado de la transición.
      logger.info(
        {
          userId: resolved.userId,
          externalSessionId,
          previousStatus: KycStatus.PENDING,
          newStatus: targetStatus,
        },
        "kyc status transition"
      );
    },

    async getStatus(userId: string): Promise<KycStatusResult> {
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
      }

      // `raw_decision.warnings` (armado por `extractDecisionWarnings` en el webhook) es
      // un array de {feature, risk, description} -- se unen las descripciones en un
      // solo string para el contrato de la respuesta (kyc.schema.ts: string | null).
      // Puede quedar vacío legítimamente (confirmado con el payload real de ejemplo de
      // `In Review`: ningún feature individual traía warnings) -- no todo caso en
      // manual_review va a tener un motivo estructurado.
      let manualReviewReason: string | null = null;
      if (user.kycStatusIdentity === KycStatus.MANUAL_REVIEW) {
        const latest = await kycVerificationRepository.findLatestByUserId(userId, "identity");
        const rawDecision = latest?.rawDecision as { warnings?: unknown } | null | undefined;
        const warnings = Array.isArray(rawDecision?.warnings) ? rawDecision.warnings : [];
        const descriptions = warnings
          .map((w) => (w && typeof w === "object" ? (w as { description?: unknown }).description : undefined))
          .filter((d): d is string => typeof d === "string");
        manualReviewReason = descriptions.length > 0 ? descriptions.join("; ") : null;
      }

      return { status: user.kycStatusIdentity, manualReviewReason };
    },
  };
}
