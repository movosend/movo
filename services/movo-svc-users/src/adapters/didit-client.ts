import { KycStatus } from "@movo/shared";
import { VerificationType } from "../models/kyc-verification";
import { createHttpDiditClient } from "./http-didit-client";
import { createMockDiditClient } from "./mock-didit-client";

/** Sesión de verificación creada contra Didit.me (AC1). */
export interface DiditSession {
  sessionId: string;
  sessionToken: string;
  url: string;
}

export interface CreateDiditSessionInput {
  /** `userId` de Movo — Didit lo guarda como `vendor_data` y lo devuelve intacto en
   * el webhook de resultado (dedupe implícito de Didit: un `vendor_data` con una
   * sesión sin terminar devuelve la sesión existente, según el spike MOVO-48). */
  vendorData: string;
  /** Determina qué `workflow_id` de Didit se usa (MOVO-15: identidad y licencia son
   * dos workflows distintos en la consola de Didit). */
  verificationType: VerificationType;
  callbackUrl?: string;
}

/** Decisión actual de una sesión ya creada, consultada bajo demanda. */
export interface DiditSessionDecision {
  sessionId: string;
  /** Vocabulario crudo de Didit (`DiditRawStatus`) — mapear con
   * `mapDiditStatusToKycStatus` antes de usarlo en el resto del servicio. */
  rawStatus: string;
  /** Cuerpo completo de la respuesta. Mismo criterio que `decision` en el webhook: no
   * se tipa en detalle porque trae PII que AC9 prohíbe persistir — solo debe pasar por
   * `extractDecisionWarnings`, nunca copiarse tal cual. */
  decision: unknown;
}

/** Interfaz detrás de la que vive la integración con Didit.me (MOVO-72), mismo
 * criterio que `SmsProvider` (MOVO-71): permite testear `kyc.service.ts` sin red y
 * cambiar de implementación (real/mock) sin tocar el resto del servicio. */
export interface DiditClient {
  createSession(input: CreateDiditSessionInput): Promise<DiditSession>;
  /**
   * Consulta la decisión actual de una sesión ya creada. Es la contraparte *pull* del
   * webhook (que es *push*): se usa para reconciliar un intento `pending` antes de
   * descartarlo como abandonado, cerrando la ventana en la que el usuario terminó la
   * verificación pero el webhook todavía no llegó (ver
   * `kyc.service.ts#reconcilePendingAttempt`).
   *
   * Devuelve `null` si Didit no conoce la sesión (404) — ese intento se puede descartar
   * sin perder nada. Cualquier otro fallo (red, 5xx, credenciales) tira `ApiError`: la
   * política de qué hacer con un proveedor caído es del servicio, no del adapter.
   */
  getSessionDecision(sessionId: string): Promise<DiditSessionDecision | null>;
}

/**
 * Estados reales que devuelve Didit.me (relevados en el spike MOVO-48 contra la
 * documentación oficial, no contra el sandbox real todavía — ver Paso 7 del plan de
 * MOVO-72). Case-sensitive y con espacios, NO son snake_case ni coinciden con
 * `KycStatus` de `@movo/shared`.
 */
export type DiditRawStatus =
  | "Not Started"
  | "In Progress"
  | "Awaiting User"
  | "Resubmitted"
  | "Approved"
  | "Declined"
  | "In Review"
  | "Expired"
  | "Abandoned"
  | "Kyc Expired";

/**
 * Mapea el vocabulario de Didit al de `@movo/shared` — el resto del servicio nunca ve
 * un `DiditRawStatus`. Los estados intermedios (`Not Started`/`In Progress`/
 * `Awaiting User`/`Resubmitted`) no disparan transición y se ignoran (`null`).
 *
 * `Expired`/`Abandoned`/`Kyc Expired` mapean a `KycStatus.EXPIRED`: son las tres formas
 * en que Didit da por muerta una sesión que nadie completó. Es una transición terminal
 * pero NO definitiva — `EXPIRED` está en `ALLOWED_SESSION_SOURCE_STATUSES`
 * (`kyc.service.ts`), así que el usuario puede pedir una sesión nueva. Mapearlos a un
 * estado sin salida sería peor que ignorarlos.
 *
 * Siguen sin validarse contra el sandbox real (el mismo hueco que dejó abierto el Paso 7
 * del plan de MOVO-72: no hay forma de generar estos escenarios desde "Probar Webhook" de
 * la consola de Didit). El riesgo de mapearlos mal es bajo: el peor caso es que un
 * usuario tenga que reintentar el KYC.
 */
export function mapDiditStatusToKycStatus(raw: string): KycStatus | null {
  switch (raw as DiditRawStatus) {
    case "Approved":
      return KycStatus.APPROVED;
    case "Declined":
      return KycStatus.REJECTED;
    case "In Review":
      return KycStatus.MANUAL_REVIEW;
    case "Expired":
    case "Abandoned":
    case "Kyc Expired":
      return KycStatus.EXPIRED;
    default:
      return null;
  }
}

export interface DiditClientConfig {
  DIDIT_MODE: "mock" | "live";
  DIDIT_BASE_URL?: string;
  DIDIT_API_KEY?: string;
  // Didit maneja un workflow distinto por tipo de verificación (DNI vs. licencia) —
  // MOVO-15 agrega el segundo, que hasta ahora sólo tenía el lugar reservado.
  DIDIT_WORKFLOW_ID_IDENTITY?: string;
  DIDIT_WORKFLOW_ID_LICENSE?: string;
  DIDIT_WEBHOOK_SECRET?: string;
}

const DEFAULT_DIDIT_BASE_URL = "https://verification.didit.me";

/**
 * Selecciona la implementación según `DIDIT_MODE` (default "mock" — mismo criterio
 * que `SMS_PROVIDER=console`, MOVO-71): no depender de credenciales de Didit para
 * levantar el servicio en dev/test/CI, ni bloquear el resto de la US si las
 * credenciales de sandbox tardan (riesgo de cronograma señalado en la guía de
 * MOVO-72). Falla rápido al arrancar si se pide `live` sin las credenciales completas.
 */
export function createDiditClient(config: DiditClientConfig): DiditClient {
  if (config.DIDIT_MODE === "live") {
    if (
      !config.DIDIT_API_KEY ||
      !config.DIDIT_WORKFLOW_ID_IDENTITY ||
      !config.DIDIT_WORKFLOW_ID_LICENSE ||
      !config.DIDIT_WEBHOOK_SECRET
    ) {
      throw new Error(
        "DIDIT_MODE=live requiere DIDIT_API_KEY, DIDIT_WORKFLOW_ID_IDENTITY, " +
          "DIDIT_WORKFLOW_ID_LICENSE y DIDIT_WEBHOOK_SECRET"
      );
    }
    return createHttpDiditClient({
      baseUrl: config.DIDIT_BASE_URL ?? DEFAULT_DIDIT_BASE_URL,
      apiKey: config.DIDIT_API_KEY,
      workflowIds: {
        identity: config.DIDIT_WORKFLOW_ID_IDENTITY,
        license: config.DIDIT_WORKFLOW_ID_LICENSE,
      },
    });
  }
  return createMockDiditClient();
}
