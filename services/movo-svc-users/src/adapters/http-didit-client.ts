import { ApiError } from "@movo/shared";
import { VerificationType } from "../models/kyc-verification";
import {
  CreateDiditSessionInput,
  DiditClient,
  DiditSession,
  DiditSessionDecision,
  UpdateDiditSessionStatusInput,
} from "./didit-client";

export interface HttpDiditClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Un `workflow_id` de Didit por tipo de verificación (MOVO-15: identidad y
   * licencia son workflows distintos en la consola de Didit). */
  workflowIds: Record<VerificationType, string>;
}

interface DiditCreateSessionResponse {
  session_id: string;
  session_token: string;
  url: string;
}

/**
 * Respuesta de `GET /v3/session/{id}/decision/`. A diferencia del webhook (donde el
 * detalle viene anidado bajo `decision`), acá los bloques por feature
 * (`id_verifications`, `liveness_checks`, `face_matches`, …) viven en el nivel
 * superior junto a `status` — por eso el cuerpo entero es lo que se pasa como
 * `decision` a `extractDecisionWarnings`.
 */
interface DiditSessionDecisionResponse {
  session_id?: string;
  status?: string;
  [key: string]: unknown;
}

/** Tope de espera del pedido de decisión a Didit. */
export const DIDIT_UPDATE_TIMEOUT_MS = 10_000;

const unconfirmed = () =>
  new ApiError(
    502,
    "KYC_PROVIDER_UNCONFIRMED",
    "El proveedor de verificación no confirmó el cambio: puede haberse aplicado o no."
  );

/**
 * Implementación real de `DiditClient` sobre la API HTTP de Didit.me (AC1). Endpoint
 * y forma del payload/respuesta relevados en el spike MOVO-48 contra la documentación
 * oficial — `POST {baseUrl}/v3/session/` (con barra final), no `/sessions`.
 */
export function createHttpDiditClient(config: HttpDiditClientConfig): DiditClient {
  return {
    async createSession(input: CreateDiditSessionInput): Promise<DiditSession> {
      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/v3/session/`, {
          method: "POST",
          headers: {
            "x-api-key": config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflow_id: config.workflowIds[input.verificationType],
            vendor_data: input.vendorData,
            ...(input.callbackUrl ? { callback: input.callbackUrl } : {}),
          }),
        });
      } catch {
        // Red caída / timeout — no es un error de negocio, es el proveedor externo
        // no disponible (AC1 no puede cumplirse, pero no es culpa del usuario).
        throw new ApiError(502, "KYC_PROVIDER_ERROR", "No se pudo conectar con el proveedor de verificación de identidad.");
      }

      if (!response.ok) {
        // 403 documentado en el spike MOVO-48 para api-key inválida/faltante (Didit no
        // usa 401 acá, inconsistente con lo intuitivo) — se normaliza a un único código
        // de error propio en vez de propagar el status crudo del proveedor.
        throw new ApiError(502, "KYC_PROVIDER_ERROR", "El proveedor de verificación de identidad devolvió un error.");
      }

      const body = (await response.json()) as DiditCreateSessionResponse;
      return {
        sessionId: body.session_id,
        sessionToken: body.session_token,
        url: body.url,
      };
    },

    async getSessionDecision(sessionId: string): Promise<DiditSessionDecision | null> {
      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
          method: "GET",
          headers: { "x-api-key": config.apiKey },
        });
      } catch {
        throw new ApiError(502, "KYC_PROVIDER_ERROR", "No se pudo conectar con el proveedor de verificación de identidad.");
      }

      if (response.status === 404) {
        // Didit no conoce esta sesión (borrada, o de otra aplicación). No es un error:
        // el caller lo interpreta como "no hay decisión que preservar".
        return null;
      }

      if (!response.ok) {
        throw new ApiError(502, "KYC_PROVIDER_ERROR", "El proveedor de verificación de identidad devolvió un error.");
      }

      const body = (await response.json()) as DiditSessionDecisionResponse;
      if (typeof body.status !== "string") {
        // Sin `status` no hay nada que mapear — se trata como "sin decisión" en vez de
        // inventar una transición a partir de un cuerpo que no entendemos.
        return null;
      }

      return { sessionId: body.session_id ?? sessionId, rawStatus: body.status, decision: body };
    },

    async updateSessionStatus(input: UpdateDiditSessionStatusInput): Promise<void> {
      let response: Response;
      try {
        response = await fetch(
          `${config.baseUrl}/v3/session/${encodeURIComponent(input.sessionId)}/update-status/`,
          {
            method: "PATCH",
            headers: { "x-api-key": config.apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              new_status: input.newStatus,
              ...(input.comment ? { comment: input.comment } : {}),
              send_email: false,
            }),
            // Menor que los 15 s con los que svc-admin espera a este servicio: así nunca se sigue esperando a Didit después
            // de que el panel ya le informó al admin.
            signal: AbortSignal.timeout(DIDIT_UPDATE_TIMEOUT_MS),
          }
        );
      } catch {
        // Red caída o timeout: Didit pudo haber aplicado el cambio antes de que se cortara la respuesta. No es un rechazo.
        throw unconfirmed();
      }

      if (response.status === 404) {
        throw new ApiError(404, "KYC_SESSION_NOT_FOUND", "El proveedor no conoce la sesión de verificación.");
      }
      if (response.status >= 500) {
        // Un 5xx tampoco dice si el cambio quedó aplicado.
        throw unconfirmed();
      }
      if (!response.ok) {
        // 4xx: Didit rechazó el pedido y no aplicó nada (credenciales sin permiso, estado que no admite el cambio…).
        throw new ApiError(502, "KYC_PROVIDER_ERROR", "El proveedor de verificación de identidad rechazó el pedido.");
      }
    },
  };
}
