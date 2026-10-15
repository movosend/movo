/**
 * Respuestas de notificación ya atendidas y cold start ya resuelto, a nivel de módulo (MOVO-301):
 * `getLastNotificationResponseAsync` devuelve la última respuesta aunque ya se haya manejado, y si
 * `usePushNotifications` se remonta (logout → login) un `ref` por instancia la volvería a navegar.
 * Los tests lo reemplazan con `jest.mock`, así este archivo no necesita ningún reset propio.
 */
const handledResponseIds = new Set<string>();
let coldStartResolved = false;

/** `true` la primera vez que se ve esa respuesta; `false` si ya se atendió. */
export function claimNotificationResponse(responseId: string): boolean {
  if (handledResponseIds.has(responseId)) return false;
  handledResponseIds.add(responseId);
  return true;
}

/** `true` solo la primera vez en la vida del proceso: el cold start se resuelve una vez. */
export function claimColdStart(): boolean {
  if (coldStartResolved) return false;
  coldStartResolved = true;
  return true;
}
