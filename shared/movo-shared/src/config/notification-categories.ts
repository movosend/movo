/**
 * MOVO-245: catálogo único de categorías de notificación push, compartido entre
 * `movo-svc-users` (persiste/valida la preferencia, hace enforcement al enviar) y
 * `movo-mobile` (pantalla de Configuración de notificaciones).
 *
 * Diseño pensado para ser escalable sin migraciones (issue hermana MOVO-240, catálogo
 * de notificaciones faltantes): el `id` de una categoría es un string libre validado
 * acá en código, no un enum de Postgres -- sumar una categoría nueva el día que se
 * implemente un ítem de MOVO-240 es agregar una entrada a `NOTIFICATION_CATEGORIES`
 * (con `implemented: true`) y hacer que su trigger declare esa categoría al llamar
 * `sendPush` -- cero ALTER TYPE, cero backfill. La tabla de preferencias del lado de
 * `svc-users` (`NotificationCategoryPreference`) es sparse: una fila por usuario+
 * categoría SOLO cuando el usuario tocó el toggle -- ausencia de fila = habilitado
 * (AC5: toda cuenta existente arranca con todo prendido, sin importar cuántas
 * categorías nuevas se sumen después).
 *
 * `implemented: false` son las categorías del catálogo de MOVO-240 sin trigger real
 * todavía -- la pantalla las muestra grisadas ("Pronto"), sin lógica de enforcement
 * (no hay ningún `sendPush` que las use todavía). `quietHoursExempt` es la excepción
 * de "Horario de silencio" (MOVO-245, sección quiet hours): hoy ninguna categoría
 * implementada la usa (el prototipo la reserva para notificaciones de seguridad de
 * cuenta y de proximidad, ninguna de las dos implementada aún).
 */

/** Agrupación puramente cosmética para la pantalla mobile (secciones por contexto de
 * rol) -- no tiene ningún efecto en el enforcement del backend, que solo mira `id`. */
export type NotificationSection =
  | "sending" // "Cuando envío un paquete"
  | "carrying" // "Cuando transporto un paquete"
  | "account" // "Cuenta y seguridad"
  | "conversations"; // "Conversaciones y reclamos"

export interface NotificationCategoryDefinition {
  id: string;
  section: NotificationSection;
  title: string;
  sub: string;
  /** `false`: catálogo de MOVO-240, sin ningún trigger real disparando todavía --
   * la categoría existe en el catálogo para que la pantalla la muestre "Pronto", pero
   * no tiene fila de enforcement real (ningún `sendPush` declara este id hoy). */
  implemented: boolean;
  /** Si `true`, esta categoría ignora "Horario de silencio" (AC de quiet hours) --
   * pensada para notificaciones que el usuario necesita ver aunque esté en la franja
   * de silencio (seguridad de cuenta, alguien tocando timbre). Ninguna categoría
   * implementada la usa hoy -- default `false`. */
  quietHoursExempt: boolean;
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategoryDefinition[] = [
  // --- Cuando envío un paquete ---
  {
    id: "custody",
    section: "sending",
    title: "Custodia del paquete",
    sub: "Retiro y entrega confirmados por handshake",
    implemented: true,
    quietHoursExempt: false,
  },
  {
    id: "offers",
    section: "sending",
    title: "Ofertas",
    sub: "Ofertas nuevas, aceptadas, rechazadas o desplazadas",
    implemented: true,
    quietHoursExempt: false,
  },
  {
    id: "proximity",
    section: "sending",
    title: "Transportista en camino",
    sub: "Cuando entra en el radio del punto de retiro o entrega",
    implemented: false,
    quietHoursExempt: false,
  },
  {
    id: "payments",
    section: "sending",
    title: "Pagos y cobros",
    sub: "Retención de fondos y fallos de cobro",
    implemented: false,
    quietHoursExempt: false,
  },
  {
    id: "ratings",
    section: "sending",
    title: "Calificaciones",
    sub: "Recordatorio de calificar y calificaciones recibidas",
    implemented: true,
    quietHoursExempt: false,
  },

  // --- Cuando transporto un paquete ---
  {
    id: "trips",
    section: "carrying",
    title: "Viajes y matches",
    sub: "Un envío que coincide con tu camino",
    implemented: true,
    quietHoursExempt: false,
  },

  // --- Cuenta y seguridad ---
  {
    id: "kyc",
    section: "account",
    title: "Verificaciones",
    sub: "Resultado de identidad y licencia de conducir",
    implemented: false,
    quietHoursExempt: false,
  },
  {
    id: "account_security",
    section: "account",
    title: "Seguridad de la cuenta",
    sub: "Contraseña, email, teléfono y dispositivos nuevos",
    implemented: false,
    // Reservado para cuando exista el trigger (catálogo MOVO-240): un aviso de
    // seguridad de cuenta debería sonar aunque el usuario esté en horario de
    // silencio -- documentado acá para no tener que revisar este archivo de nuevo
    // cuando esa categoría pase a `implemented: true`.
    quietHoursExempt: true,
  },

  // --- Conversaciones y reclamos ---
  {
    id: "chat",
    section: "conversations",
    title: "Mensajes",
    sub: "Mensaje nuevo de la contraparte de un envío",
    implemented: false,
    quietHoursExempt: false,
  },
  {
    id: "disputes",
    section: "conversations",
    title: "Disputas",
    sub: "Apertura y resolución de un reclamo",
    implemented: false,
    quietHoursExempt: false,
  },
  {
    id: "shipments",
    section: "sending",
    title: "Envíos",
    sub: "Creación, confirmación y cancelación de tus envíos",
    implemented: true,
    quietHoursExempt: false,
  },
] as const;

export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORIES)[number]["id"];

const IMPLEMENTED_IDS = new Set(
  NOTIFICATION_CATEGORIES.filter((c) => c.implemented).map((c) => c.id)
);

/** Categorías con al menos un trigger real -- son las únicas sobre las que
 * `svc-users` acepta un valor explícito al hacer PUT y las únicas que
 * `sendPushToUser` puede recibir como `category`. */
export const IMPLEMENTED_NOTIFICATION_CATEGORY_IDS: readonly string[] = Array.from(IMPLEMENTED_IDS);

export function isImplementedNotificationCategory(id: string): boolean {
  return IMPLEMENTED_IDS.has(id);
}

export function getNotificationCategory(id: string): NotificationCategoryDefinition | undefined {
  return NOTIFICATION_CATEGORIES.find((c) => c.id === id);
}
