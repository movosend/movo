import { PrismaClient } from "../../generated/prisma/client";
import { ApiError, IMPLEMENTED_NOTIFICATION_CATEGORY_IDS, isValidTimeOfDay } from "@movo/shared";
import {
  createNotificationPreferenceRepository,
  UpsertPreferencesInput,
} from "../../repositories/notification-preference-repository";

export interface NotificationCategoryState {
  id: string;
  enabled: boolean;
}

/** Forma expuesta por `GET`/`PUT /users/me/notification-preferences` (AC4: se
 * persiste server-side, sobrevive reinstalar la app / cambiar de dispositivo). */
export interface ResolvedNotificationPreferences {
  pushEnabled: boolean;
  quietHours: { enabled: boolean; from: string; to: string };
  categories: NotificationCategoryState[];
}

export interface UpdateNotificationPreferencesInput {
  pushEnabled?: boolean;
  quietHours?: { enabled?: boolean; from?: string; to?: string };
  /** Solo categorías IMPLEMENTADAS (`IMPLEMENTED_NOTIFICATION_CATEGORY_IDS`) -- una
   * key desconocida o de una categoría todavía "Pronto" es 400 (AC de MOVO-245: el
   * cliente no puede inventar una preferencia sobre algo que no existe). */
  categories?: Record<string, boolean>;
}

export function createNotificationPreferencesService(db: PrismaClient) {
  const repository = createNotificationPreferenceRepository(db);

  async function resolve(userId: string): Promise<ResolvedNotificationPreferences> {
    const [prefs, overrides] = await Promise.all([
      repository.getPreferences(userId),
      repository.getCategoryOverrides(userId),
    ]);
    return {
      pushEnabled: prefs.pushEnabled,
      quietHours: { enabled: prefs.quietHoursEnabled, from: prefs.quietHoursFrom, to: prefs.quietHoursTo },
      // AC5: cualquier categoría implementada sin fila explícita resuelve a `true`
      // -- incluida una categoría que se implementó DESPUÉS de que este usuario
      // dejó de tocar la pantalla, sin backfill.
      categories: IMPLEMENTED_NOTIFICATION_CATEGORY_IDS.map((id) => ({
        id,
        enabled: overrides.get(id) ?? true,
      })),
    };
  }

  return {
    async getPreferences(userId: string): Promise<ResolvedNotificationPreferences> {
      return resolve(userId);
    },

    async updatePreferences(
      userId: string,
      input: UpdateNotificationPreferencesInput
    ): Promise<ResolvedNotificationPreferences> {
      if (input.categories) {
        for (const category of Object.keys(input.categories)) {
          if (!IMPLEMENTED_NOTIFICATION_CATEGORY_IDS.includes(category)) {
            throw new ApiError(
              400,
              "VALIDATION_FAILED",
              `"${category}" no es una categoría de notificación válida todavía.`
            );
          }
        }
      }

      if (input.quietHours?.from !== undefined && !isValidTimeOfDay(input.quietHours.from)) {
        throw new ApiError(400, "VALIDATION_FAILED", "quietHours.from debe tener formato HH:MM.");
      }
      if (input.quietHours?.to !== undefined && !isValidTimeOfDay(input.quietHours.to)) {
        throw new ApiError(400, "VALIDATION_FAILED", "quietHours.to debe tener formato HH:MM.");
      }

      const masterUpdate: UpsertPreferencesInput = {};
      if (input.pushEnabled !== undefined) masterUpdate.pushEnabled = input.pushEnabled;
      if (input.quietHours?.enabled !== undefined) masterUpdate.quietHoursEnabled = input.quietHours.enabled;
      if (input.quietHours?.from !== undefined) masterUpdate.quietHoursFrom = input.quietHours.from;
      if (input.quietHours?.to !== undefined) masterUpdate.quietHoursTo = input.quietHours.to;

      if (Object.keys(masterUpdate).length > 0) {
        await repository.upsertPreferences(userId, masterUpdate);
      }

      if (input.categories) {
        await Promise.all(
          Object.entries(input.categories).map(([category, enabled]) =>
            repository.setCategoryEnabled(userId, category, enabled)
          )
        );
      }

      return resolve(userId);
    },
  };
}
