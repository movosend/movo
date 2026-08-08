import { ApiError } from "@movo/shared";
import { CreateDiditSessionInput, DiditClient, DiditSession, DiditSessionDecision } from "./didit-client";

export interface HttpDiditClientConfig {
  baseUrl: string;
  apiKey: string;
  workflowId: string;
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
            workflow_id: config.workflowId,
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
  };
}
