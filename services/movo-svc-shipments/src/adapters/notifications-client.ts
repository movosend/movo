import { FastifyBaseLogger } from "fastify";

/**
 * Cliente HTTP interno hacia `movo-svc-users` (`POST /internal/notifications/push`,
 * MOVO-106) — mismo patrón servicio-a-servicio que `users-client.ts` (MOVO-80), pero
 * con una diferencia deliberada: acá `sendPush` NUNCA rechaza. AC5 de MOVO-108 exige
 * que el disparo de notificaciones sea best-effort y nunca bloquee la operación
 * principal (creación de envío, cancelación, etc.) — en vez de confiar en que cada
 * caller recuerde envolver la llamada en un try/catch, la garantía vive acá, una sola
 * vez, para todos los callers presentes y futuros (MOVO-23/MOVO-17 cuando existan).
 */
export interface SendPushInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationsClient {
  sendPush(input: SendPushInput): Promise<void>;
}

export interface NotificationsClientConfig {
  USERS_SERVICE_URL: string;
}

// Más corto que el de users-client.ts (5s): esa llamada es parte del camino crítico de
// creación de envío (su resultado decide si el envío se crea), esta no -- nunca vale
// la pena esperar mucho por algo cuyo resultado se descarta si falla.
const REQUEST_TIMEOUT_MS = 3000;

export function createNotificationsClient(
  config: NotificationsClientConfig,
  logger: FastifyBaseLogger
): NotificationsClient {
  return {
    async sendPush(input: SendPushInput): Promise<void> {
      try {
        // El endpoint interno de svc-users (AC6 de MOVO-106) no pasa por el gateway y
        // no exige x-user-id -- confía en el caller por red interna (ADR-010), el
        // userId de destino viaja en el body.
        const response = await fetch(`${config.USERS_SERVICE_URL}/internal/notifications/push`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`svc-users respondió ${response.status}`);
        }
      } catch (error) {
        // AC5: cubre red caída, timeout y respuesta no-2xx por igual -- en los tres
        // casos el resultado para el caller es el mismo, seguir sin notificar.
        logger.warn(
          {
            event: "notification_dispatch_failed",
            userId: input.userId,
            error: error instanceof Error ? error.message : String(error),
          },
          "No se pudo despachar la notificación push"
        );
      }
    },
  };
}
