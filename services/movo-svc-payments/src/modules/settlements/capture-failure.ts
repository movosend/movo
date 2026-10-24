import type { SettlementFailureReason } from "@movo/shared";

/**
 * MOVO-213 (AC4): qué fallos de la captura se arreglan reintentando y cuáles no.
 *
 * - **Reintentable**: error de red o timeout con MP (sin respuesta), 408/429/5xx, un estado de pago inesperado
 *   o una consulta del desglose que falló. Pueden ser transitorios.
 * - **No reintentable**: escalan de inmediato, sin gastar intentos. Un hold vencido o cancelado no vuelve; una
 *   cuenta de MP desvinculada o con las credenciales rechazadas solo se arregla si el transportista se
 *   re-vincula; y cualquier otro 4xx de MP es un rechazo del pedido, que repetirlo no cambia.
 *
 * Un hold que ya estaba capturado no es un fallo: `capture.service` adopta el pago `approved`.
 */
export function isRetryableCaptureFailure(input: { reason: SettlementFailureReason; mpHttpStatus?: number }): boolean {
  switch (input.reason) {
    case "hold_expired":
    case "carrier_account_unavailable":
      return false;
    case "unexpected_payment_status":
      return true;
    case "provider_error": {
      const status = input.mpHttpStatus;
      if (status === undefined || status >= 500 || status === 408 || status === 429) return true;
      return status < 400;
    }
  }
}

/** Esperas por defecto antes de cada reintento: 5 min, 30 min y 2 h (3 reintentos tras el intento inicial). */
export const DEFAULT_RETRY_DELAYS_MINUTES: readonly number[] = [5, 30, 120];

/** `"5,30,120"` → `[5, 30, 120]`. Lanza si algún valor no es un número positivo (corta el arranque). */
export function parseRetryDelays(csv: string): number[] {
  const delays = csv.split(",").map((part) => Number(part.trim()));
  if (delays.length === 0 || delays.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error(`SETTLEMENT_RETRY_DELAYS_MINUTES inválido: "${csv}" (se esperan minutos positivos separados por coma)`);
  }
  return delays;
}

/**
 * Cuándo toca el próximo reintento tras el fallo número `attemptsMade` (1 = el intento inicial), o `null` si ya
 * se gastaron todos: con 3 esperas, el fallo 4 (el tercer reintento) es el último y escala.
 */
export function nextRetryAt(attemptsMade: number, now: Date, delaysMinutes: readonly number[]): Date | null {
  const delay = delaysMinutes[attemptsMade - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay * 60_000);
}
