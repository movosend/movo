import { FastifyBaseLogger } from "fastify";
import { ApiError, KycStatus } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { User } from "../../models/user";
import { createUserRepository, UserRepository } from "../../repositories/user-repository";
import { createKycVerificationRepository } from "../../repositories/kyc-verification-repository";
import { createDriversLicenseRepository } from "../../repositories/drivers-license-repository";
import { DiditClient, DiditSessionDecision, mapDiditStatusToKycStatus } from "../../adapters/didit-client";
import { KycVerification, VerificationType } from "../../models/kyc-verification";
import { verifyDiditSignature } from "../../adapters/didit-signature";
import { PushSender, sendTriggerPush } from "../notifications/send-trigger-push";

/** Los seis triggers de KYC (MOVO-274): ninguno lleva datos dinámicos, así que
 * `renderNotificationTrigger` los renderiza sin parámetros. */
type KycTriggerKey =
  | "kycIdentityApproved"
  | "kycIdentityRejected"
  | "kycIdentityManualReview"
  | "kycLicenseApproved"
  | "kycLicenseRejected"
  | "kycLicenseManualReview";

/**
 * MOVO-274: qué aviso corresponde a cada (tipo de verificación, resultado). Solo los
 * tres estados que le importan al usuario — `expired`/`pending`/`not_started` no son
 * un resultado y nunca avisan (`undefined`).
 */
const KYC_RESULT_TRIGGERS: Record<VerificationType, Partial<Record<KycStatus, KycTriggerKey>>> = {
  identity: {
    [KycStatus.APPROVED]: "kycIdentityApproved",
    [KycStatus.REJECTED]: "kycIdentityRejected",
    [KycStatus.MANUAL_REVIEW]: "kycIdentityManualReview",
  },
  license: {
    [KycStatus.APPROVED]: "kycLicenseApproved",
    [KycStatus.REJECTED]: "kycLicenseRejected",
    [KycStatus.MANUAL_REVIEW]: "kycLicenseManualReview",
  },
};

/**
 * Estados desde los que se puede pedir una sesión nueva (AC2) — todos menos `approved`
 * (una identidad/licencia ya verificada no se vuelve a verificar). Aplica igual a los
 * dos `VerificationType` (MOVO-15): no hay ninguna regla que exija que la identidad
 * esté aprobada antes de poder verificar la licencia, ningún AC la pide.
 *
 * `pending` está incluido a propósito, revirtiendo la política original de MOVO-72 ("un
 * intento en curso no se reintenta ni devuelve, se rechaza (409)"). Esa regla asumía que
 * un intento `pending` siempre termina resolviéndose por webhook, y no es cierto:
 * `createSession` marca `pending` ANTES de que el cliente llegue a la UI de Didit, así
 * que si el SDK falla ahí (sin conexión, sin development build, app cerrada a mitad)
 * Didit no tiene nada que reportar y el webhook nunca llega. El usuario quedaba trabado
 * en `pending` para siempre, sin ninguna forma de reintentar.
 *
 * A cambio, `createSession` marca el intento anterior como `expired` antes de abrir el
 * nuevo (ver abajo). Ese descarte llegó a costar la decisión real de una verificación ya
 * completada cuyo webhook venía en camino — hoy no, porque `reconcilePendingAttempt` se
 * la pide a Didit y la aplica antes de descartar nada (revisión de PR #52).
 */
const ALLOWED_SESSION_SOURCE_STATUSES: ReadonlySet<KycStatus> = new Set([
  KycStatus.NOT_STARTED,
  KycStatus.REJECTED,
  KycStatus.MANUAL_REVIEW,
  KycStatus.PENDING,
  KycStatus.EXPIRED,
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
 * `extractDecisionWarnings`/`extractDocumentExpirationDate`.
 *
 * **No hay un campo `reason` de nivel superior.** `decision.reviews` tampoco sirve
 * (queda vacío incluso en el payload real de ejemplo de `In Review` — se completa
 * recién cuando un humano termina una revisión manual en el back-office de Didit,
 * después de este webhook). El motivo real vive disperso en
 * `decision.<feature>[].warnings[]` (confirmado con un payload real de `Declined`:
 * `decision.id_verifications[0].warnings[0]` trae
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

export interface DecisionWarning {
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
export function extractDecisionWarnings(decision: unknown): DecisionWarning[] {
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
 * Fecha de vencimiento impresa en el documento (MOVO-15, `users.drivers_license.
 * expiration_date`) — campo de nivel superior del feature "ID Verification" de Didit
 * (misma categoría que `document_number`/`document_type`, confirmado por el equipo que
 * no es dato biométrico, AC6 sigue cumplido). Aplica tanto al webhook
 * (`decision.id_verifications[0]`) como a la respuesta pulleada de
 * `getSessionDecision` (`decision.id_verifications[0]` también, ver
 * `buildRedactedPulledDecision`) — mismo shape de `decision` en ambos casos. Nunca
 * tira: si `id_verifications` falta, está vacío, o el campo no es un string, devuelve
 * `null` en vez de inventar una fecha.
 */
function extractDocumentExpirationDate(decision: unknown): string | null {
  if (!decision || typeof decision !== "object") {
    return null;
  }
  const idVerifications = (decision as Record<string, unknown>)["id_verifications"];
  if (!Array.isArray(idVerifications) || idVerifications.length === 0) {
    return null;
  }
  const first = idVerifications[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const value = (first as Record<string, unknown>)["expiration_date"];
  return typeof value === "string" ? value : null;
}

/**
 * Identidad leída del documento por Didit (`decision.id_verifications[0]`): nombre de pila y
 * apellidos tal como figuran en el documento (la normalización a "Nombre Apellido" la hace
 * `UserRepository.setVerifiedIdentity`), número de documento y fecha de nacimiento.
 * `dni` y `birthdate` son `null` si el campo falta o no es válido; el nombre es obligatorio:
 * sin nombre y apellido la función devuelve `null` y la aprobación pasa a revisión manual.
 *
 * Es PII: va directo a las columnas de `users` y nunca a `raw_decision` (AC9, ver
 * `buildRedactedRawDecision`). Mismo shape en el webhook y en el pull. Nunca tira.
 */
export interface VerifiedDocumentIdentity {
  firstName: string;
  lastName: string;
  dni: string | null;
  birthdate: Date | null;
}

const DNI_PATTERN = /^\d{7,8}$/;

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractVerifiedIdentity(decision: unknown): VerifiedDocumentIdentity | null {
  if (!decision || typeof decision !== "object") return null;
  const idVerifications = (decision as Record<string, unknown>)["id_verifications"];
  if (!Array.isArray(idVerifications) || idVerifications.length === 0) return null;
  const first = idVerifications[0];
  if (!first || typeof first !== "object") return null;
  const doc = first as Record<string, unknown>;

  const firstName = readString(doc, "first_name");
  const lastName = readString(doc, "last_name");
  if (!firstName || !lastName) return null;

  const documentNumber = readString(doc, "document_number")?.replace(/[.\s-]/g, "") ?? null;
  const dateOfBirth = readString(doc, "date_of_birth");
  const birthdate = dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null;

  return {
    firstName,
    lastName,
    dni: documentNumber && DNI_PATTERN.test(documentNumber) ? documentNumber : null,
    birthdate: birthdate && !Number.isNaN(birthdate.getTime()) ? birthdate : null,
  };
}

/**
 * Whitelist explícita de campos "seguros" del payload del webhook (AC9: Movo no
 * persiste imágenes de documentos ni datos biométricos). Se arma campo por campo en vez
 * de guardar el payload completo, para que un campo nuevo que Didit agregue mañana
 * (ej. una URL de foto) no se cuele por default — en particular, `payload.decision`
 * nunca se copia tal cual, solo se le pasa a `extractDecisionWarnings`/
 * `extractDocumentExpirationDate`.
 */
function buildRedactedRawDecision(payload: DiditWebhookPayload): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  if (typeof payload.status === "string") redacted["status"] = payload.status;
  if (typeof payload.session_id === "string") redacted["session_id"] = payload.session_id;
  if (typeof payload.vendor_data === "string") redacted["vendor_data"] = payload.vendor_data;
  const warnings = extractDecisionWarnings(payload.decision);
  if (warnings.length > 0) redacted["warnings"] = warnings;
  const expirationDate = extractDocumentExpirationDate(payload.decision);
  if (expirationDate) redacted["expiration_date"] = expirationDate;
  return redacted;
}

/**
 * Equivalente de `buildRedactedRawDecision` para la vía *pull* (`getSessionDecision`).
 * Mismo criterio de AC9 —whitelist explícita, el cuerpo crudo nunca se copia tal cual—,
 * con dos diferencias por la forma de esa respuesta: el detalle por feature viene en el
 * nivel superior (no anidado bajo `decision`), y no hay `vendor_data`.
 */
function buildRedactedPulledDecision(decision: DiditSessionDecision): Record<string, unknown> {
  const redacted: Record<string, unknown> = {
    status: decision.rawStatus,
    session_id: decision.sessionId,
  };
  const warnings = extractDecisionWarnings(decision.decision);
  if (warnings.length > 0) redacted["warnings"] = warnings;
  const expirationDate = extractDocumentExpirationDate(decision.decision);
  if (expirationDate) redacted["expiration_date"] = expirationDate;
  return redacted;
}

/**
 * Motivo legible de un intento a partir de `raw_decision.warnings` (ya redactado por
 * `buildRedactedRawDecision`): las descripciones unidas en un solo string, o `null` si no hay
 * ninguna. Lo usan el estado de KYC (`manualReviewReason`) y la ficha del panel (MOVO-294).
 */
export function describeDecisionWarnings(rawDecision: unknown): string | null {
  const warnings = (rawDecision as { warnings?: unknown } | null | undefined)?.warnings;
  if (!Array.isArray(warnings)) return null;
  const descriptions = warnings
    .map((w) => (w && typeof w === "object" ? (w as { description?: unknown }).description : undefined))
    .filter((d): d is string => typeof d === "string");
  return descriptions.length > 0 ? descriptions.join("; ") : null;
}

/** Lee el `KycStatus` vigente de un usuario para un tipo de verificación dado — evita
 * repetir el `if (type === "identity") ... else ...` en cada punto que necesita leer
 * el estado (MOVO-15). */
function getUserKycStatus(user: User, verificationType: VerificationType): KycStatus {
  return verificationType === "identity" ? user.kycStatusIdentity : user.kycStatusLicense;
}

/** Contraparte de escritura de `getUserKycStatus` — dispatcha al método correcto de
 * `UserRepository` según el tipo de verificación (MOVO-15). */
function updateUserKycStatus(
  userRepository: UserRepository,
  userId: string,
  verificationType: VerificationType,
  status: KycStatus
): Promise<User | null> {
  return verificationType === "identity"
    ? userRepository.updateKycStatusIdentity(userId, status)
    : userRepository.updateKycStatusLicense(userId, status);
}

export function createKycService(
  db: PrismaClient,
  diditClient: DiditClient,
  webhookSecret: string | undefined,
  logger: FastifyBaseLogger,
  notifications: PushSender
) {
  const userRepository = createUserRepository(db);
  const kycVerificationRepository = createKycVerificationRepository(db);

  /**
   * MOVO-274: avisa al usuario el resultado de una verificación. Se llama SOLO con el
   * `KycVerification` que devolvió `applyTerminalDecision` (nunca `null`): ese es el
   * gate de idempotencia, así que un webhook repetido, o el pull que llega después del
   * webhook (o al revés), no manda un segundo push — cada transición real avisa una vez.
   *
   * Va después de que la transacción ya commiteó y es best-effort: un fallo del push
   * (o de resolver preferencias) se loguea y se traga. Si lanzara, el webhook
   * respondería 5xx y Didit reintentaría un evento que ya se aplicó, y un `getStatus`
   * fallaría por un aviso. El copy no lleva el motivo del rechazo ni datos del
   * documento (AC9 de MOVO-72) — el detalle se ve dentro de la app.
   */
  async function notifyDecision(resolved: KycVerification, status: KycStatus): Promise<void> {
    const triggerKey = KYC_RESULT_TRIGGERS[resolved.verificationType][status];
    if (!triggerKey) {
      return;
    }
    await sendTriggerPush({
      notifications,
      userId: resolved.userId,
      triggerKey,
      params: undefined,
      data: { type: "kyc_result", verificationType: resolved.verificationType, status },
      logger,
      onErrorContext: {
        event: "kyc_push_failed",
        message: "no se pudo enviar el push del resultado de KYC; la decisión ya estaba aplicada",
        extra: { verificationType: resolved.verificationType, status },
      },
    });
  }

  /**
   * Aplica una decisión terminal de Didit sobre un intento que sigue en `pending` o
   * `manual_review`, sincronizando el caché de `users` en la misma transacción.
   *
   * Es el único camino de escritura de una decisión, sin importar si llegó por webhook
   * (*push*) o por `getSessionDecision` (*pull*) — así las dos rutas comparten el mismo
   * gate de idempotencia (AC7) y no pueden divergir. Devuelve `null` si la fila ya no
   * estaba en ninguno de esos dos estados: webhook duplicado, o la otra ruta ganó la
   * carrera.
   *
   * `manual_review` está en el gate a propósito, no solo `pending`: Didit puede mandar
   * DOS webhooks terminales para la misma sesión — primero `pending` → `manual_review`
   * (entra a revisión humana) y después, cuando un operador la resuelve,
   * `manual_review` → `approved`/`rejected`. Con el gate limitado a `fromStatus:
   * pending` (como era antes), ese segundo webhook nunca aplicaba: la fila ya estaba en
   * `manual_review`, no en `pending`, así que `resolveByExternalSessionId` la ignoraba
   * como si fuera un duplicado — un caso real reportado (aprobación manual en la
   * consola de Didit, webhook "entregado" según Didit, pero el usuario seguía viendo
   * "en revisión" sin ninguna forma de destrabarse).
   *
   * Esa excepción NO aplica cuando el destino es el propio `manual_review`: ahí el origen
   * válido es solo `pending`. Didit sigue devolviendo `In Review` todo el tiempo que dura
   * la revisión humana (en cada webhook repetido y en cada pull de "actualizar estado"),
   * y con `manual_review` también como origen la compuerta lo contaba como una transición
   * `manual_review` → `manual_review`: devolvía la fila en vez de `null`, reescribía
   * `resolvedAt`/`raw_decision` y, con MOVO-274, volvía a mandar el push de "en revisión"
   * (review de PR #215). Quedarse en el mismo estado no es una transición, así que
   * devuelve `null` como cualquier duplicado (AC7).
   *
   * MOVO-15: además de sincronizar `users.kyc_status_identity`/`kyc_status_license`
   * (según `result.verificationType`), si el tipo es `license` y la decisión es
   * `approved`, upsertea `users.drivers_license` en la misma transacción — es el único
   * punto de escritura de esa tabla.
   */
  async function applyTerminalDecision(
    externalSessionId: string,
    targetStatus: KycStatus,
    rawDecision: Record<string, unknown>,
    identity: VerifiedDocumentIdentity | null
  ): Promise<KycVerification | null> {
    return db.$transaction(async (tx) => {
      const txKycVerificationRepository = createKycVerificationRepository(tx);

      // Una identidad aprobada sin nombre legible no se aprueba sola: el nombre de la cuenta sale
      // del documento, así que sin él se manda a revisión manual (con el motivo a la vista).
      // Solo aplica a la verificación de identidad; la de licencia no toca el nombre.
      let effectiveStatus = targetStatus;
      let effectiveRawDecision = rawDecision;
      if (targetStatus === KycStatus.APPROVED && !identity) {
        const attempt = await txKycVerificationRepository.findByExternalSessionId(externalSessionId);
        if (attempt?.verificationType === "identity") {
          effectiveStatus = KycStatus.MANUAL_REVIEW;
          const previous = Array.isArray(rawDecision["warnings"]) ? (rawDecision["warnings"] as unknown[]) : [];
          effectiveRawDecision = {
            ...rawDecision,
            warnings: [
              ...previous,
              {
                feature: "ID_VERIFICATION",
                risk: "NAME_NOT_DETECTED",
                description: "No se pudo leer el nombre del documento.",
              },
            ],
          };
          logger.warn(
            { externalSessionId, event: "kyc_identity_without_name" },
            "identidad aprobada por Didit sin nombre legible: pasa a revisión manual"
          );
        }
      }

      const fromStatus =
        effectiveStatus === KycStatus.MANUAL_REVIEW
          ? [KycStatus.PENDING]
          : [KycStatus.PENDING, KycStatus.MANUAL_REVIEW];

      const result = await txKycVerificationRepository.resolveByExternalSessionId({
        externalSessionId,
        fromStatus,
        toStatus: effectiveStatus,
        rawDecision: effectiveRawDecision,
      });
      if (result) {
        const txUserRepository = createUserRepository(tx);
        await updateUserKycStatus(txUserRepository, result.userId, result.verificationType, effectiveStatus);

        // El nombre se guarda apenas Didit lo lee, también si la verificación queda en revisión manual: así la cuenta ya
        // lo tiene mientras alguien decide, y aprobar solo lo confirma (o el admin lo corrige). No se guarda si se rechaza.
        if (
          result.verificationType === "identity" &&
          identity &&
          (effectiveStatus === KycStatus.APPROVED || effectiveStatus === KycStatus.MANUAL_REVIEW)
        ) {
          // Una sola vez por transición: está dentro del gate de idempotencia de arriba.
          await txUserRepository.setVerifiedIdentity(result.userId, {
            firstName: identity.firstName,
            lastName: identity.lastName,
            // El documento manda: un número que no es un DNI (o una fecha ilegible) deja el dato en `null` en vez de
            // conservar el de otro documento (por ejemplo, el que tipeó una cuenta vieja).
            dni: identity.dni,
            birthdate: identity.birthdate,
          });
        }

        if (result.verificationType === "license" && effectiveStatus === KycStatus.APPROVED) {
          const expirationDateStr =
            typeof (result.rawDecision as { expiration_date?: unknown } | null)?.expiration_date === "string"
              ? ((result.rawDecision as { expiration_date: string }).expiration_date as string)
              : null;
          const txDriversLicenseRepository = createDriversLicenseRepository(tx);
          await txDriversLicenseRepository.upsertVerified({
            userId: result.userId,
            kycVerificationId: result.id,
            expirationDate: expirationDateStr ? new Date(expirationDateStr) : null,
          });
        }
      }
      return result;
    });
  }

  /**
   * Cierra la ventana entre "Didit ya tiene una decisión (terminó la verificación, o un
   * operador resolvió la revisión manual)" y "el webhook con esa decisión llegó" —
   * llamada tanto antes de abrir una sesión nueva (`createSession`, para no descartar un
   * resultado real) como en cada `getStatus` (`GET /kyc/status`/`GET /kyc/license/status`,
   * para que "actualizar estado" en el mobile revalide contra Didit en vez de mostrar
   * únicamente lo último que el webhook logró aplicar).
   *
   * Dispara para dos estados, no solo `pending`:
   * - `pending`: `createSession` descarta los intentos `pending` previos
   *   (`expirePendingByUserId`) para no dejar trabado a quien nunca llegó a la UI de
   *   Didit. Pero `pending` es también el estado de alguien que SÍ completó la
   *   verificación segundos atrás, y descartarlo a ciegas hace que el webhook tardío
   *   deje de matchear — la decisión real se perdía en silencio.
   * - `manual_review`: Didit puede resolver la revisión humana en cualquier momento
   *   después del primer webhook (`In Review`), con un segundo webhook terminal
   *   (`Approved`/`Declined`) que nuestro backend puede no haber recibido o procesado
   *   (túnel de desarrollo caído, red, etc.) — sin este pull, no había ninguna forma de
   *   que el usuario saliera de "en revisión" salvo que ese segundo webhook llegara
   *   solo. Caso real reportado: aprobación manual confirmada en la consola de Didit
   *   ("entregado"), pero la app seguía mostrando "en revisión" sin cambiar nunca.
   *
   * Se le pregunta a Didit por la decisión de la sesión más reciente; si ya es terminal
   * se aplica por el mismo camino que el webhook (`applyTerminalDecision`, que acepta
   * ambos estados como origen — ver su comentario). Devuelve el estado efectivo del
   * usuario después de reconciliar.
   */
  async function reconcilePendingAttempt(
    userId: string,
    verificationType: VerificationType,
    currentStatus: KycStatus
  ): Promise<KycStatus> {
    if (currentStatus !== KycStatus.PENDING && currentStatus !== KycStatus.MANUAL_REVIEW) {
      return currentStatus;
    }

    const latest = await kycVerificationRepository.findLatestByUserId(userId, verificationType);
    if (!latest || latest.status !== currentStatus) {
      return currentStatus;
    }

    let decision: DiditSessionDecision | null;
    try {
      decision = await diditClient.getSessionDecision(latest.externalSessionId);
    } catch (error) {
      // Proveedor caído: se sigue de largo con el descarte en vez de bloquear el
      // reintento. Falla hacia la fricción (rehacer el KYC) y no hacia dejar a alguien
      // sin salida, que es el pozo que este flujo vino a resolver.
      logger.warn(
        { userId, externalSessionId: latest.externalSessionId, err: error, event: "kyc_reconcile_failed" },
        "no se pudo consultar la decisión del intento en curso; se sigue con el estado actual"
      );
      return currentStatus;
    }

    if (!decision) {
      // Didit no conoce la sesión — no hay decisión que preservar.
      return currentStatus;
    }

    const targetStatus = mapDiditStatusToKycStatus(decision.rawStatus);
    if (targetStatus === null) {
      // Estado no terminal (`Not Started`/`In Progress`/`Awaiting User`/`Resubmitted`):
      // el intento sigue realmente en curso, no hay nada que preservar.
      return currentStatus;
    }

    const resolved = await applyTerminalDecision(
      latest.externalSessionId,
      targetStatus,
      buildRedactedPulledDecision(decision),
      extractVerifiedIdentity(decision.decision)
    );

    if (!resolved) {
      // El webhook llegó entre la consulta y la escritura y ya aplicó la decisión por su
      // cuenta. Se relee el usuario para no seguir con un estado viejo en la mano.
      const refreshed = await userRepository.findById(userId);
      return refreshed ? getUserKycStatus(refreshed, verificationType) : currentStatus;
    }

    logger.info(
      {
        userId,
        externalSessionId: latest.externalSessionId,
        verificationType,
        previousStatus: currentStatus,
        newStatus: resolved.status,
        event: "kyc_reconciled",
      },
      "kyc status transition (reconciliada por pull, no por webhook)"
    );

    await notifyDecision(resolved, resolved.status);
    return resolved.status;
  }

  return {
    /**
     * Resuelve desde el panel de admin un intento en `manual_review`: le pide a Didit que
     * cierre la sesión (`update-status`) y aplica la decisión acá mismo por
     * `applyTerminalDecision`, el mismo camino que usa el webhook. No espera al webhook de
     * Didit: si llega después, la fila ya está resuelta, `applyTerminalDecision` devuelve
     * `null` y no hay un segundo push.
     *
     * Dos admins a la vez no llegan acá: la ruta toma un lock por sesión antes (ver `kyc-review-internal.routes.ts`).
     *
     * Solo se puede decidir el último intento del usuario: `createSession` deja vivo un
     * `manual_review` viejo si el usuario abre una sesión nueva, y decidirlo pisaría el
     * estado de la sesión más reciente. Si Didit responde 2xx pero la escritura local falla,
     * el intento sigue en `manual_review` y `reconcilePendingAttempt` lo corrige en el
     * próximo "actualizar estado" del usuario.
     */
    async decideManualReview(input: {
      externalSessionId: string;
      decision: KycStatus.APPROVED | KycStatus.REJECTED;
      reason: string;
      /** Nombre y apellido corregidos por el admin al aprobar una identidad; pisan los que leyó Didit. */
      name?: { firstName: string; lastName: string };
    }): Promise<KycVerification> {
      const attempt = await kycVerificationRepository.findByExternalSessionId(input.externalSessionId);
      if (!attempt) {
        throw new ApiError(404, "KYC_SESSION_NOT_FOUND", "No existe esa verificación.");
      }
      if (attempt.status !== KycStatus.MANUAL_REVIEW) {
        throw new ApiError(409, "KYC_REVIEW_STATUS_CHANGED", "La verificación ya no está en revisión manual.");
      }
      const latest = await kycVerificationRepository.findLatestByUserId(attempt.userId, attempt.verificationType);
      if (!latest || latest.id !== attempt.id) {
        throw new ApiError(409, "KYC_REVIEW_SUPERSEDED", "El usuario ya abrió una verificación más reciente.");
      }

      // Antes de pedir el cambio, lo que Didit ya tiene: la sesión pudo resolverse en su consola, o en un pedido anterior
      // que quedó sin confirmar (`KYC_PROVIDER_UNCONFIRMED`). Si ya está resuelta, se aplica esa decisión acá y no se le
      // pide otra a Didit (pisarla dejaría a Movo y a Didit en estados distintos). Si Didit no responde, todavía no se
      // cambió nada: el `KYC_PROVIDER_ERROR` de esta lectura es un rechazo seguro.
      const current = await diditClient.getSessionDecision(attempt.externalSessionId);
      const already = current ? mapDiditStatusToKycStatus(current.rawStatus) : null;
      if (current && already !== null && already !== KycStatus.MANUAL_REVIEW) {
        const reconciled = await applyTerminalDecision(
          attempt.externalSessionId,
          already,
          buildRedactedPulledDecision(current),
          extractVerifiedIdentity(current.decision)
        );
        if (reconciled) {
          logger.info(
            { externalSessionId: attempt.externalSessionId, newStatus: already, event: "kyc_reconciled_before_decision" },
            "kyc status transition (Didit ya la tenía resuelta al decidir desde el panel)"
          );
          await notifyDecision(reconciled, already);
        }
        throw new ApiError(409, "KYC_REVIEW_STATUS_CHANGED", "Didit ya tenía resuelta esta verificación: se aplicó su decisión.", {
          status: already,
        });
      }

      const approved = input.decision === KycStatus.APPROVED;

      // Aprobar una identidad confirma el nombre, el DNI y la fecha de nacimiento de la cuenta (DD-065). El nombre sale, en este
      // orden, de lo que corrigió el admin, de lo que Didit extrajo de la sesión o de lo que la cuenta ya tenía guardado de
      // cuando la verificación pasó a revisión. Sin ninguno no hay con qué completarlo: se corta ANTES de pedirle el cambio a
      // Didit, así Movo y Didit no quedan en estados distintos, y el admin tiene que escribirlo.
      let identity: VerifiedDocumentIdentity | null = null;
      if (approved && attempt.verificationType === "identity") {
        const extracted = extractVerifiedIdentity(current?.decision);
        const stored = await userRepository.findById(attempt.userId);
        const firstName = input.name?.firstName.trim() || extracted?.firstName || stored?.firstName.trim() || "";
        const lastName = input.name?.lastName.trim() || extracted?.lastName || stored?.lastName.trim() || "";
        if (!firstName || !lastName) {
          throw new ApiError(
            409,
            "KYC_REVIEW_IDENTITY_MISSING",
            "Falta el nombre y el apellido: Didit no los leyó del documento. Escribilos para poder aprobar."
          );
        }
        // Sin lectura de Didit, el DNI y la fecha que la cuenta ya tenía (guardados cuando pasó a revisión) se conservan.
        identity = {
          firstName,
          lastName,
          dni: extracted ? extracted.dni : (stored?.dni ?? null),
          birthdate: extracted ? extracted.birthdate : (stored?.birthdate ?? null),
        };
      }

      await diditClient.updateSessionStatus({
        sessionId: attempt.externalSessionId,
        newStatus: approved ? "Approved" : "Declined",
        comment: input.reason,
      });

      // Se conservan los `warnings` y el vencimiento ya redactados; el motivo del admin no se
      // copia acá (vive en la bitácora de svc-admin, y puede mencionar datos de la persona).
      const previous = (attempt.rawDecision && typeof attempt.rawDecision === "object" ? attempt.rawDecision : {}) as Record<
        string,
        unknown
      >;
      const resolved = await applyTerminalDecision(
        attempt.externalSessionId,
        input.decision,
        {
          ...previous,
          status: approved ? "Approved" : "Declined",
          reviewed_by_admin: true,
        },
        identity
      );

      if (!resolved) {
        // Otra ruta (webhook de Didit o pull) lo resolvió entre la lectura y la escritura.
        const current = await kycVerificationRepository.findByExternalSessionId(attempt.externalSessionId);
        if (current && current.status === input.decision) {
          return current;
        }
        throw new ApiError(409, "KYC_REVIEW_STATUS_CHANGED", "La verificación cambió de estado mientras se resolvía.");
      }

      logger.info(
        {
          userId: resolved.userId,
          externalSessionId: resolved.externalSessionId,
          verificationType: resolved.verificationType,
          newStatus: input.decision,
          event: "kyc_manual_review_decided",
        },
        "kyc status transition (decidida por un admin desde el panel)"
      );
      await notifyDecision(resolved, input.decision);
      return resolved;
    },

    async createSession(userId: string, verificationType: VerificationType): Promise<CreateKycSessionResult> {
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
      }
      if (!user.phoneVerified) {
        throw new ApiError(409, "KYC_SESSION_NOT_ALLOWED", "El teléfono todavía no fue verificado.");
      }
      // Un `pending` puede estar escondiendo una decisión ya tomada en Didit cuyo
      // webhook todavía no llegó — se reconcilia ANTES de evaluar si se permite abrir
      // una sesión nueva, para no descartar ese resultado (ver la función).
      const effectiveStatus = await reconcilePendingAttempt(userId, verificationType, getUserKycStatus(user, verificationType));

      if (!ALLOWED_SESSION_SOURCE_STATUSES.has(effectiveStatus)) {
        throw new ApiError(
          409,
          "KYC_SESSION_NOT_ALLOWED",
          "El estado de verificación actual no permite crear una nueva sesión."
        );
      }

      const session = await diditClient.createSession({ vendorData: userId, verificationType });

      // Las tres escrituras (descartar intentos viejos + el intento nuevo + el caché en
      // `users`) en una sola transacción -- evita que queden desincronizadas si algo
      // falla a mitad de camino.
      const supersededCount = await db.$transaction(async (tx) => {
        const txKycVerificationRepository = createKycVerificationRepository(tx);
        const txUserRepository = createUserRepository(tx);

        // Cualquier intento `pending` previo se da por abandonado. Además de destrabar
        // al usuario, esto apoya la idempotencia del webhook sin código extra: como
        // `resolveByExternalSessionId` solo aplica una transición si la fila sigue en
        // `pending`, un webhook tardío de la sesión descartada deja de matchear y se
        // ignora solo -- en particular, ya no puede pisar el caché de `users` con el
        // resultado de una sesión que este usuario abandonó.
        const superseded = await txKycVerificationRepository.expirePendingByUserId({
          userId,
          verificationType,
          exceptExternalSessionId: session.sessionId,
        });

        await txKycVerificationRepository.upsertPendingSession({
          userId,
          verificationType,
          provider: "didit",
          externalSessionId: session.sessionId,
        });
        await updateUserKycStatus(txUserRepository, userId, verificationType, KycStatus.PENDING);
        return superseded;
      });

      // AC11: registro estructurado del evento (pino, ya activo en Fastify::app.log).
      logger.info(
        { userId, verificationType, sessionId: session.sessionId, supersededCount, event: "kyc_session_created" },
        "KYC session created"
      );

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

      // Idempotencia (AC7): `applyTerminalDecision` solo aplica la transición si el
      // intento seguía en `pending` o `manual_review` -- un webhook duplicado, o fuera
      // de orden, devuelve `null` acá y no se toca nada más. Es el mismo camino que usa
      // la reconciliación por pull (ver `reconcilePendingAttempt`), a propósito. No
      // hace falta saber el `verificationType` acá: `applyTerminalDecision` lo lee de
      // la fila resuelta y dispatcha solo (MOVO-15).
      const resolved = await applyTerminalDecision(
        externalSessionId,
        targetStatus,
        rawDecision,
        extractVerifiedIdentity(payload.decision)
      );

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
          verificationType: resolved.verificationType,
          externalSessionId,
          newStatus: resolved.status,
        },
        "kyc status transition"
      );

      await notifyDecision(resolved, resolved.status);
    },

    async getStatus(userId: string, verificationType: VerificationType): Promise<KycStatusResult> {
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new ApiError(404, "NOT_FOUND", "Usuario no encontrado.");
      }

      // Antes de devolver el estado cacheado en `users`, se revalida contra Didit si el
      // usuario está en `pending`/`manual_review` (ver `reconcilePendingAttempt`) — sin
      // esto, `GET /kyc/status`/`GET /kyc/license/status` era una simple lectura de
      // caché: si por lo que fuera un webhook terminal no se procesó (túnel de
      // desarrollo caído, red, o el bug que motivó ampliar `applyTerminalDecision` a
      // aceptar `manual_review` como origen), no había ninguna forma de que el usuario
      // saliera de ese estado desde el mobile ("actualizar estado" solo releía el mismo
      // valor viejo, sin cambiar nunca) salvo que abriera una sesión nueva. Es una
      // llamada de red extra por consulta de estado, pero no se sondea en loop desde el
      // mobile — se llama al entrar a la pantalla y ante un click explícito del usuario.
      const effectiveStatus = await reconcilePendingAttempt(userId, verificationType, getUserKycStatus(user, verificationType));

      // `raw_decision.warnings` (armado por `extractDecisionWarnings` en el webhook) es
      // un array de {feature, risk, description} -- se unen las descripciones en un
      // solo string para el contrato de la respuesta (kyc.schema.ts: string | null).
      // Puede quedar vacío legítimamente (confirmado con el payload real de ejemplo de
      // `In Review`: ningún feature individual traía warnings) -- no todo caso en
      // manual_review va a tener un motivo estructurado.
      let manualReviewReason: string | null = null;
      if (effectiveStatus === KycStatus.MANUAL_REVIEW) {
        const latest = await kycVerificationRepository.findLatestByUserId(userId, verificationType);
        manualReviewReason = describeDecisionWarnings(latest?.rawDecision);
      }

      return { status: effectiveStatus, manualReviewReason };
    },
  };
}
