import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategoryDefinition,
  type NotificationSection,
} from "@movo/shared/dist/config/notification-categories";
import {
  NOTIFICATION_TRIGGERS,
  type NotificationCopy,
} from "@movo/shared/dist/config/notification-templates";
import type { NotificationCategoryState } from "../api/notification-preferences-client";

/**
 * MOVO-246: helpers puros sobre el catálogo real de `@movo/shared` (MOVO-245) — la
 * pantalla nunca hardcodea las 12 filas ficticias del prototipo de Claude Design
 * (`Notificaciones.dc.html`), solo su lenguaje visual. Ver la entrada de MOVO-246 en
 * `movo-mobile/CLAUDE.md` para el detalle de qué difiere del prototipo y por qué.
 */

/** Copy en español de cada sección — el catálogo compartido solo trae el `id`
 * (`NotificationSection`), la agrupación es "puramente cosmética" del lado mobile
 * (comentario del propio archivo compartido). */
export const SECTION_META: Record<NotificationSection, { title: string; note: string }> = {
  sending: { title: "Cuando envío o recibo un paquete", note: "Sos el emisor o receptor del paquete." },
  carrying: { title: "Cuando transporto un paquete", note: "Sos el que lleva el paquete en su camino." },
  account: {
    title: "Cuenta y seguridad",
    note: "Siempre te escribimos por mail. Acá elegís si además suena el teléfono.",
  },
  conversations: { title: "Conversaciones y reclamos", note: "" },
};

const SECTION_ORDER: readonly NotificationSection[] = ["sending", "carrying", "account", "conversations"];

export interface NotificationSectionGroup {
  section: NotificationSection;
  title: string;
  note: string;
  categories: readonly NotificationCategoryDefinition[];
}

/** Agrupa `NOTIFICATION_CATEGORIES` por sección, en el orden fijo de arriba —
 * preserva el orden de declaración del catálogo dentro de cada sección. */
export function groupCategoriesBySection(): NotificationSectionGroup[] {
  return SECTION_ORDER.map((section) => ({
    section,
    title: SECTION_META[section].title,
    note: SECTION_META[section].note,
    categories: NOTIFICATION_CATEGORIES.filter((c) => c.section === section),
  })).filter((group) => group.categories.length > 0);
}

export function getNotificationCategoryDefinition(id: string): NotificationCategoryDefinition | undefined {
  return NOTIFICATION_CATEGORIES.find((c) => c.id === id);
}

/** Triggers reales de una categoría (solo categorías implementadas tienen alguno —
 * `NOTIFICATION_TRIGGERS` no declara ningún trigger para una categoría "Pronto"). El
 * `displayCopy` de cada uno ES el copy real del push (sin datos dinámicos
 * interpolados), no una redacción aparte para la pantalla de catálogo. */
export function triggersForCategory(categoryId: string): NotificationCopy[] {
  return Object.values(NOTIFICATION_TRIGGERS)
    .filter((trigger) => trigger.category === categoryId)
    .map((trigger) => trigger.displayCopy);
}

export function isCategoryEnabled(categories: NotificationCategoryState[], id: string): boolean {
  // Ausencia de fila = habilitado (AC5 del backend, ver notification-categories.ts).
  return categories.find((c) => c.id === id)?.enabled ?? true;
}

export function quietHoursSummaryLabel(quietHours: { enabled: boolean; from: string; to: string }): string {
  if (!quietHours.enabled) return "Desactivado";
  return `De ${quietHours.from} a ${quietHours.to}`;
}

/** "N/M activas" del header del hub — solo sobre categorías implementadas (las
 * únicas que el backend expone en `categories`, AC2). */
export function activeCategoriesLabel(categories: NotificationCategoryState[]): string {
  const active = categories.filter((c) => c.enabled).length;
  return `${active}/${categories.length} activas`;
}
