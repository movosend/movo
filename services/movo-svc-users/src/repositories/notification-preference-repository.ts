import { Prisma } from "../generated/prisma/client";
import { IMPLEMENTED_NOTIFICATION_CATEGORY_IDS } from "@movo/shared";

/** Fila resuelta de `users.notification_preferences` (MOVO-245) — el toggle maestro
 * + "Horario de silencio". A diferencia de `NotificationCategoryPreference`, esta fila
 * SÍ se crea con defaults explícitos la primera vez que se necesita (no queda sparse):
 * es 1 sola fila por usuario, no N por categoría, así que no hay ningún beneficio de
 * espacio en dejarla implícita. */
export interface NotificationPreferences {
  pushEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursFrom: string;
  quietHoursTo: string;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  pushEnabled: true,
  quietHoursEnabled: false,
  quietHoursFrom: "23:00",
  quietHoursTo: "08:00",
};

export interface UpsertPreferencesInput {
  pushEnabled?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursFrom?: string;
  quietHoursTo?: string;
}

export interface NotificationPreferenceRepository {
  /** AC5: usuario que nunca tocó nada -- resuelve a `DEFAULT_PREFERENCES` sin crear
   * fila (mismo criterio "sparse" que las categorías, aunque acá técnicamente sea una
   * sola fila -- evita un write de más en cada lectura de un usuario que nunca
   * configuró nada). */
  getPreferences(userId: string): Promise<NotificationPreferences>;
  upsertPreferences(userId: string, input: UpsertPreferencesInput): Promise<NotificationPreferences>;
  /** Solo las categorías con una fila explícita (el usuario la tocó alguna vez) --
   * el caller resuelve el default (habilitado) para cualquier categoría ausente. */
  getCategoryOverrides(userId: string): Promise<Map<string, boolean>>;
  /**
   * `enabled: true` (el default implícito) BORRA la fila en vez de persistir `true`
   * -- mantiene la tabla realmente sparse, no solo "sparse en la práctica": un
   * usuario que prende y apaga una categoría varias veces nunca acumula filas viejas
   * en `true`.
   */
  setCategoryEnabled(userId: string, category: string, enabled: boolean): Promise<void>;
}

function toDomainPreferences(
  row: Prisma.NotificationPreferenceGetPayload<Record<string, never>> | null
): NotificationPreferences {
  if (!row) return DEFAULT_PREFERENCES;
  return {
    pushEnabled: row.pushEnabled,
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursFrom: row.quietHoursFrom,
    quietHoursTo: row.quietHoursTo,
  };
}

export function createNotificationPreferenceRepository(
  db: Prisma.TransactionClient
): NotificationPreferenceRepository {
  return {
    async getPreferences(userId: string): Promise<NotificationPreferences> {
      const row = await db.notificationPreference.findUnique({ where: { userId } });
      return toDomainPreferences(row);
    },

    async upsertPreferences(userId: string, input: UpsertPreferencesInput): Promise<NotificationPreferences> {
      const row = await db.notificationPreference.upsert({
        where: { userId },
        create: { userId, ...DEFAULT_PREFERENCES, ...input },
        update: { ...input },
      });
      return toDomainPreferences(row);
    },

    async getCategoryOverrides(userId: string): Promise<Map<string, boolean>> {
      const rows = await db.notificationCategoryPreference.findMany({
        where: { userId, category: { in: [...IMPLEMENTED_NOTIFICATION_CATEGORY_IDS] } },
        select: { category: true, enabled: true },
      });
      return new Map(rows.map((r) => [r.category, r.enabled]));
    },

    async setCategoryEnabled(userId: string, category: string, enabled: boolean): Promise<void> {
      if (enabled) {
        // Volver al default implícito -- sin `catch`: `deleteMany` no tira si no
        // encuentra nada (a diferencia de `delete`), es el borrado idempotente que
        // corresponde acá (el caller no sabe ni le importa si había una fila).
        await db.notificationCategoryPreference.deleteMany({ where: { userId, category } });
        return;
      }
      await db.notificationCategoryPreference.upsert({
        where: { userId_category: { userId, category } },
        create: { userId, category, enabled: false },
        update: { enabled: false },
      });
    },
  };
}
