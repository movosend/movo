import { ApiError, ReputationBreakdown, RecentRatingComment, TransactionCounts } from "@movo/shared";

/**
 * MOVO-152: forma de `GET /internal/users/:id/reputation` (`svc-shipments`, MOVO-147)
 * -- global + desglose por rol + contadores de transacciones reales.
 */
export interface UserReputationSummary extends ReputationBreakdown {
  asSender: ReputationBreakdown;
  asCarrier: ReputationBreakdown;
  transactionCounts: TransactionCounts;
}

/**
 * Cliente HTTP síncrono hacia `movo-svc-shipments` — primera llamada interna en este
 * sentido (hasta ahora la única llamada servicio-a-servicio del proyecto era la
 * inversa, `svc-shipments` → `svc-users`, ver `users-client.ts` de MOVO-80). Pega
 * contra endpoints internos `/internal/*`, no proxeados por el gateway.
 */
export interface ShipmentsClient {
  /**
   * ¿El usuario (como sender, receiver o carrier) tiene algún envío en un estado no
   * terminal? Usado por `DELETE /users/me` antes de aplicar la baja de cuenta -- nunca
   * lanza por "tiene envíos activos", esa es una decisión de negocio del caller
   * (`users.service.ts#deleteAccount`), no un fallo de transporte.
   */
  hasActiveShipments(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }>;
  /**
   * MOVO-152: agregado de reputación de `userId`. A diferencia de
   * `hasActiveShipments`, este método SÍ lanza ante cualquier falla (red, timeout,
   * respuesta no-ok) -- es `users.service.ts#resolveReputationSummary` quien decide
   * qué hacer con eso (AC3: el perfil nunca falla por la reputación, cae a
   * `reputationScore: null` + contadores en cero), no este cliente HTTP.
   */
  findReputation(userId: string): Promise<UserReputationSummary>;
  /**
   * MOVO-152 AC2: últimas `limit` calificaciones recibidas por `userId`, leídas de
   * `GET /internal/users/:id/ratings/recent` (`svc-shipments`, MOVO-146 AC10). Mismo
   * criterio de "lanza y el caller decide" que `findReputation` -- se piden aparte
   * porque solo hacen falta al componer un perfil completo (AC2), no en cada lectura
   * liviana (ej. `GET /users/search`).
   */
  findRecentRatingComments(userId: string, limit: number): Promise<RecentRatingComment[]>;
}

export interface ShipmentsClientConfig {
  SHIPMENTS_SERVICE_URL: string;
}

// A diferencia de users-client.ts (MOVO-80), acá sí hay timeout explícito: una demora
// en svc-shipments colgaría la baja de cuenta, y el caller no tiene un fallback seguro.
const REQUEST_TIMEOUT_MS = 5000;

// MOVO-152: más corto que REQUEST_TIMEOUT_MS -- acá degradar a "sin reputación" es
// gratis (AC3), mismo criterio/motivo que pricing-client.ts de movo-svc-shipments (no
// vale la pena hacer esperar la apertura de un perfil tanto tiempo antes de resolver
// al fallback).
const REPUTATION_REQUEST_TIMEOUT_MS = 3000;

interface RatingApiResponse {
  id: string;
  raterId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

export function createShipmentsClient(config: ShipmentsClientConfig): ShipmentsClient {
  return {
    async hasActiveShipments(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }> {
      let response: Response;
      try {
        response = await fetch(
          `${config.SHIPMENTS_SERVICE_URL}/internal/account-deletion/users/${encodeURIComponent(userId)}/active-shipments`,
          {
            method: "GET",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }
        );
      } catch {
        // Cubre red caída y timeout por igual -- en ambos casos el resultado para el
        // caller es el mismo: no se pudo confirmar que la cuenta esté libre de envíos
        // activos, así que la baja no se aplica (sin alternativa segura a "permitir
        // siempre" acá, a diferencia de MOVO-80 con la validación de receptor).
        throw new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de envíos.");
      }

      if (!response.ok) {
        throw new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "El servicio de envíos devolvió un error.");
      }

      return (await response.json()) as { hasActiveDispute: boolean; hasActiveShipments: boolean };
    },

    async findReputation(userId: string): Promise<UserReputationSummary> {
      const response = await fetch(
        `${config.SHIPMENTS_SERVICE_URL}/internal/users/${encodeURIComponent(userId)}/reputation`,
        { method: "GET", signal: AbortSignal.timeout(REPUTATION_REQUEST_TIMEOUT_MS) }
      );
      if (!response.ok) {
        throw new Error(`El servicio de envíos devolvió status ${response.status} al pedir la reputación.`);
      }
      return (await response.json()) as UserReputationSummary;
    },

    async findRecentRatingComments(userId: string, limit: number): Promise<RecentRatingComment[]> {
      const response = await fetch(
        `${config.SHIPMENTS_SERVICE_URL}/internal/users/${encodeURIComponent(userId)}/ratings/recent?limit=${limit}`,
        { method: "GET", signal: AbortSignal.timeout(REPUTATION_REQUEST_TIMEOUT_MS) }
      );
      if (!response.ok) {
        throw new Error(`El servicio de envíos devolvió status ${response.status} al pedir las calificaciones recientes.`);
      }
      const rows = (await response.json()) as RatingApiResponse[];
      return rows.map((row) => ({
        id: row.id,
        raterId: row.raterId,
        score: row.score,
        comment: row.comment,
        createdAt: row.createdAt,
      }));
    },
  };
}
