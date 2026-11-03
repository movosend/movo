import { focusManager, QueryClient } from "@tanstack/react-query";
import { AppState } from "react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";

/** Reintentos ante red o 5xx (el default de React Query es 3). */
const MAX_RETRIES = 2;

/**
 * MOVO-346 (punto 6): un 4xx no se arregla reintentando, y un 429 reintentado agrava el rate limit
 * que lo causó (nginx limita por IP: al volver a primer plano la app ya dispara muchas requests
 * juntas). Solo se reintentan errores de red y 5xx.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) return false;
  return failureCount < MAX_RETRIES;
}

/**
 * Conecta el foco de React Query con `AppState`: sin esto, en RN la app siempre cuenta como
 * enfocada (el listener por defecto escucha `visibilitychange` de `window`, que RN no tiene) y los
 * `refetchInterval` siguen corriendo en segundo plano, y al volver se disparan todos juntos. Una sola
 * vez por proceso, no en cada `createQueryClient`: el `focusManager` es global.
 */
let focusConnected = false;
function connectFocusToAppState(): void {
  if (focusConnected) return;
  focusConnected = true;
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => subscription.remove();
  });
}

/**
 * `refetchOnWindowFocus` queda apagado: antes de conectar el foco a `AppState` nunca se disparaba en
 * RN (por lo de arriba), así que ninguna pantalla dependía de él, y prenderlo ahora sumaría una ráfaga
 * de requests al volver a primer plano (el 429 del punto 6). Las pantallas que necesitan datos frescos
 * al volver refrescan solas (`useFocusEffect`, `AppState`).
 */
export function createQueryClient(): QueryClient {
  connectFocusToAppState();
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false },
    },
  });
}
