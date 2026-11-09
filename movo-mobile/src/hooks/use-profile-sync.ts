import { useInvalidateOnPushOrForeground } from "./use-invalidate-on-push-or-foreground";

/** Prefijo de todas las queries del perfil (propio y público), incluidas la reputación y "Ver todas". */
const PROFILE_QUERY_KEY = ["profile"] as const;
const PROFILE_CHANGING_PUSH_TYPES: readonly string[] = ["rating_received"];

/**
 * Mantiene al día el perfil cuando alguien te califica. Antes la reseña nueva no aparecía en
 * "Tu reputación" hasta que algo refrescara la query (feedback de TestFlight, build 17).
 */
export function useProfileSync(): void {
  useInvalidateOnPushOrForeground(PROFILE_QUERY_KEY, PROFILE_CHANGING_PUSH_TYPES);
}
