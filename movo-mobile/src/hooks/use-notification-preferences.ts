import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationPreferencesClient,
  type NotificationPreferences,
  type UpdateNotificationPreferencesInput,
} from "../api/notification-preferences-client";

export const NOTIFICATION_PREFERENCES_QUERY_KEY = ["notification-preferences", "me"] as const;

/** `GET /users/me/notification-preferences` (MOVO-245/246). */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: notificationPreferencesClient.getPreferences,
  });
}

/**
 * `PUT /users/me/notification-preferences` — devuelve el recurso completo, así que
 * la cache se siembra con `setQueryData` en vez de refetchear (mismo criterio que
 * `useUpdateProfile` en `use-profile.ts`): el toggle maestro, horario de silencio y
 * cada categoría comparten esta única mutación/query key, así que tocar cualquiera
 * de los tres deja a los otros dos sincronizados sin un viaje de red extra.
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation<NotificationPreferences, unknown, UpdateNotificationPreferencesInput>({
    mutationFn: (body) => notificationPreferencesClient.updatePreferences(body),
    onSuccess: (prefs) => {
      queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, prefs);
    },
  });
}
