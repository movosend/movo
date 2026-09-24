import { httpClient } from "./http-client";

/**
 * `GET`/`PUT /users/me/notification-preferences` (MOVO-245 backend, MOVO-246
 * mobile) — toggle maestro de push, horario de silencio, y desglose por categoría.
 * Wire contract espejado a mano acá (no hay un tipo compartido en `@movo/shared`
 * para la RESPUESTA de este endpoint todavía, a diferencia de `NOTIFICATION_CATEGORIES`/
 * `NOTIFICATION_TRIGGERS`, que sí son compartidos — ver `notification-settings-format.ts`).
 */
export interface NotificationCategoryState {
  id: string;
  enabled: boolean;
}

export interface NotificationPreferences {
  pushEnabled: boolean;
  quietHours: { enabled: boolean; from: string; to: string };
  /** Solo categorías implementadas (`IMPLEMENTED_NOTIFICATION_CATEGORY_IDS` de
   * `@movo/shared`) — una categoría "Pronto" nunca aparece acá. */
  categories: NotificationCategoryState[];
}

/** `PUT` body — PATCH semantics: un campo ausente no se toca. `categories` acepta
 * solo ids implementados, el backend responde 400 `VALIDATION_FAILED` con
 * cualquier otro. */
export interface UpdateNotificationPreferencesInput {
  pushEnabled?: boolean;
  quietHours?: { enabled?: boolean; from?: string; to?: string };
  categories?: Record<string, boolean>;
}

export const notificationPreferencesClient = {
  getPreferences(): Promise<NotificationPreferences> {
    return httpClient.get<NotificationPreferences>("/users/me/notification-preferences");
  },

  updatePreferences(body: UpdateNotificationPreferencesInput): Promise<NotificationPreferences> {
    return httpClient.put<NotificationPreferences>("/users/me/notification-preferences", body);
  },
};
