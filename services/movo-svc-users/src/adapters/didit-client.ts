import { KycStatus } from "@movo/shared";
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
  callbackUrl?: string;
}

/** Interfaz detrás de la que vive la integración con Didit.me (MOVO-72), mismo
 * criterio que `SmsProvider` (MOVO-71): permite testear `kyc.service.ts` sin red y
 * cambiar de implementación (real/mock) sin tocar el resto del servicio. */
export interface DiditClient {
  createSession(input: CreateDiditSessionInput): Promise<DiditSession>;
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
 * un `DiditRawStatus`. Solo los 3 estados terminales del AC6 disparan una transición;
 * el resto son intermedios (no terminales) y se ignoran (`null`).
 *
 * `Expired`/`Abandoned`/`Kyc Expired` quedan sin mapear a propósito: el spike MOVO-48
 * no llegó a confirmar contra el sandbox real qué comportamiento esperar de estos —
 * se definen en el Paso 7 del plan de MOVO-72 en vez de asumir ahora.
 */
export function mapDiditStatusToKycStatus(raw: string): KycStatus | null {
  switch (raw as DiditRawStatus) {
    case "Approved":
      return KycStatus.APPROVED;
    case "Declined":
      return KycStatus.REJECTED;
    case "In Review":
      return KycStatus.MANUAL_REVIEW;
    default:
      return null;
  }
}

export interface DiditClientConfig {
  DIDIT_MODE: "mock" | "live";
  DIDIT_BASE_URL?: string;
  DIDIT_API_KEY?: string;
  // Didit maneja un workflow distinto por tipo de verificación (DNI vs. licencia) — el
  // nombre lleva el sufijo `_IDENTITY` a propósito, para dejar el lugar libre a
  // `DIDIT_WORKFLOW_ID_LICENSE` el día que se implemente esa integración (MOVO-72 solo
  // escribe filas `identity` en `kyc_verification`, ver models/kyc-verification.ts).
  DIDIT_WORKFLOW_ID_IDENTITY?: string;
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
    if (!config.DIDIT_API_KEY || !config.DIDIT_WORKFLOW_ID_IDENTITY || !config.DIDIT_WEBHOOK_SECRET) {
      throw new Error(
        "DIDIT_MODE=live requiere DIDIT_API_KEY, DIDIT_WORKFLOW_ID_IDENTITY y DIDIT_WEBHOOK_SECRET"
      );
    }
    return createHttpDiditClient({
      baseUrl: config.DIDIT_BASE_URL ?? DEFAULT_DIDIT_BASE_URL,
      apiKey: config.DIDIT_API_KEY,
      workflowId: config.DIDIT_WORKFLOW_ID_IDENTITY,
    });
  }
  return createMockDiditClient();
}
