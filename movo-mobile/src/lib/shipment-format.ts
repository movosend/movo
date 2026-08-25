import { ShipmentStatus } from "@movo/shared/dist/types/shipment";

/** Etiqueta en español de cada estado del ciclo de vida (`shipment-state-machine.ts`
 * en `movo-svc-shipments`, MOVO-105) — un valor nuevo en el enum obliga a decidir acá
 * también, el fallback (`status` crudo) es deliberadamente poco amigable para que se
 * note en QA si falta agregar la traducción. */
const STATUS_LABEL: Record<ShipmentStatus, string> = {
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION]: "Esperando receptor",
  [ShipmentStatus.REJECTED_BY_RECEIVER]: "Rechazado",
  [ShipmentStatus.PUBLISHED]: "Publicado",
  [ShipmentStatus.ASSIGNMENT_PENDING]: "Sin asignar",
  [ShipmentStatus.ASSIGNED]: "Asignado",
  [ShipmentStatus.IN_TRANSIT]: "En camino",
  [ShipmentStatus.DELIVERED]: "Entregado",
  [ShipmentStatus.CANCELLED]: "Cancelado",
  [ShipmentStatus.DISPUTED]: "En disputa",
};

export function shipmentStatusLabel(
  status: ShipmentStatus,
  options?: { isReceiver?: boolean },
): string {
  if (status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION && options?.isReceiver !== undefined) {
    return options.isReceiver ? "Requiere tu confirmación" : "Esperando al receptor";
  }
  return STATUS_LABEL[status] ?? status;
}

/** Tono visual del estado, reusa la misma paleta semántica que `kyc-status-ui.tsx`.
 * Agrupado por lo que el tono debería comunicarle al usuario, no por "humor" del
 * estado (feedback post-implementación, MOVO-127/MOVO-29): `warning` queda
 * reservado a los dos estados que sí esperan una acción de alguien
 * (`awaiting_receiver_confirmation` del receptor, `disputed` en revisión); el resto
 * del camino feliz que avanza solo (`assignment_pending`/`assigned`/`in_transit`)
 * comparte `info` como progreso automático, y `danger` queda reservado a los dos
 * únicos estados terminales fallidos — antes `disputed` compartía ese rojo con
 * ellos, aunque una disputa todavía se puede resolver bien. */
export function shipmentStatusTone(
  status: ShipmentStatus,
): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case ShipmentStatus.DELIVERED:
      return "success";
    case ShipmentStatus.CANCELLED:
    case ShipmentStatus.REJECTED_BY_RECEIVER:
      return "danger";
    case ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION:
    case ShipmentStatus.DISPUTED:
      return "warning";
    case ShipmentStatus.ASSIGNMENT_PENDING:
    case ShipmentStatus.ASSIGNED:
    case ShipmentStatus.IN_TRANSIT:
      return "info";
    case ShipmentStatus.PUBLISHED:
    default:
      return "neutral";
  }
}

/** Agrupa el ciclo de vida en dos etapas para las tabs "En curso"/"Completados" de
 * "Mis Envíos" (MOVO-127) — patrón estándar de listados de pedidos/viajes (Uber,
 * apps de delivery). `DISPUTED` cuenta como "en curso": todavía espera una resolución,
 * no es un estado final desde la perspectiva del usuario. */
export function shipmentLifecycleStage(status: ShipmentStatus): "ongoing" | "past" {
  switch (status) {
    case ShipmentStatus.DELIVERED:
    case ShipmentStatus.CANCELLED:
    case ShipmentStatus.REJECTED_BY_RECEIVER:
      return "past";
    default:
      return "ongoing";
  }
}

/** Estado de confirmación del receptor (AC7 de MOVO-127, feedback post-QA) — derivado
 * de `ShipmentStatus`, no hay una columna separada: `awaiting_receiver_confirmation`/
 * `rejected_by_receiver` son los únicos dos estados donde el receptor todavía no dio
 * el visto bueno; cualquier estado posterior (`published` en adelante) implica que ya
 * confirmó, porque no hay transición posible sin pasar por esa confirmación. */
export function receiverConfirmationStatus(
  status: ShipmentStatus,
): "pending" | "confirmed" | "rejected" | undefined {
  if (status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION) return "pending";
  if (status === ShipmentStatus.REJECTED_BY_RECEIVER) return "rejected";
  if (status === ShipmentStatus.CANCELLED || status === ShipmentStatus.DISPUTED) {
    return undefined;
  }
  return "confirmed";
}

/** Estados desde los que el emisor puede cancelar sin penalización (MOVO-29,
 * implementado en MOVO-108) — los únicos 3 sin fondos confirmados todavía. Cancelar
 * desde `assigned` existe en `shipment-state-machine.ts` pero el backend lo bloquea
 * con 409 hasta que `svc-payments` tenga holds/capture reales, así que acá no se
 * ofrece el botón para ese ni ningún otro estado. */
export function canCancelShipment(status: ShipmentStatus): boolean {
  return (
    status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION ||
    status === ShipmentStatus.PUBLISHED ||
    status === ShipmentStatus.ASSIGNMENT_PENDING
  );
}

/** Nunca "$0" — un envío recién creado sin precio acordado todavía muestra la
 * sugerencia, nunca un número que parezca gratis. */
export function formatShipmentPrice(agreedPriceArs: number | null, suggestedPriceArs: number): string {
  const price = agreedPriceArs ?? suggestedPriceArs;
  if (price === null || price === undefined || Number.isNaN(price)) return "Precio a definir";
  return `$${price.toLocaleString("es-AR")}`;
}

/** Hermana de `formatShipmentPrice`, para el preview de precio del paso de resumen
 * del wizard de envíos (MOVO-83, AC7/AC8) — ahí no hay todavía un `ShipmentSummary`
 * real, solo un `number | null` de un `PricingProvider` (mock o real). `null`
 * significa "falta un dato requerido o el servicio de pricing no respondió". */
export function formatPriceArs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "Precio a estimar";
  return `$${value.toLocaleString("es-AR")}`;
}

const PICKUP_DATE_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "long",
});

/** `pickupDate` viaja como string `"YYYY-MM-DD"` (wire format, sin hora) — se parsea
 * con año/mes/día explícitos, nunca `new Date(pickupDate)`, para no interpretarlo como
 * medianoche UTC y correr el día en zonas horarias negativas (Argentina, UTC-3). */
export function formatPickupDateLabel(pickupDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return null;
  const [year, month, day] = pickupDate.split("-").map(Number);
  return PICKUP_DATE_FORMATTER.format(new Date(year, month - 1, day));
}

/** Título de un evento de la línea de tiempo (`GET /shipments/:id/events`, MOVO-128)
 * — narrativo y en pasado ("Transportista asignado"), a diferencia de
 * `shipmentStatusLabel`, que nombra el estado actual del envío ("Transportista
 * asignado" como situación). El evento inicial (`fromStatus === null`, único caso
 * garantizado por el backend) se muestra como "Envío creado" en vez de "Esperando
 * confirmación": lo que pasó ahí fue la creación, el estado es solo su consecuencia. */
export function shipmentEventTitle(
  toStatus: ShipmentStatus,
  fromStatus: ShipmentStatus | null,
  options?: { receiverName?: string | null; isReceiver?: boolean },
): string {
  if (fromStatus === null) return "Envío creado";

  // La aceptación del receptor no tiene estado propio: es exactamente la transición
  // `awaiting_receiver_confirmation -> published` (`acceptShipment` en
  // `shipments.service.ts` la hace en un solo `updateStatus`, MOVO-129 / grafo de
  // MOVO-105). Titularla por el `toStatus` la mostraba como "Publicado para
  // transportistas" a secas, escondiendo el paso que el usuario está esperando —
  // acá se nombra por lo que hizo la persona, y la publicación queda como
  // consecuencia en `shipmentEventDetail`.
  if (
    fromStatus === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
    toStatus === ShipmentStatus.PUBLISHED
  ) {
    if (options?.isReceiver) return "Aceptaste el envío";
    const receiver = options?.receiverName || "El receptor";
    return `${receiver} aceptó el envío`;
  }

  switch (toStatus) {
    case ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION:
      return "Esperando confirmación";
    case ShipmentStatus.REJECTED_BY_RECEIVER:
      if (options?.isReceiver) return "Rechazaste el envío";
      return `${options?.receiverName || "El receptor"} rechazó el envío`;
    case ShipmentStatus.PUBLISHED:
      return "Publicado para transportistas";
    case ShipmentStatus.ASSIGNMENT_PENDING:
      return "Buscando transportista";
    case ShipmentStatus.ASSIGNED:
      return "Transportista asignado";
    case ShipmentStatus.IN_TRANSIT:
      return "El paquete salió en camino";
    case ShipmentStatus.DELIVERED:
      return "Paquete entregado";
    case ShipmentStatus.CANCELLED:
      return "Envío cancelado";
    case ShipmentStatus.DISPUTED:
      return "Envío en disputa";
    default:
      return shipmentStatusLabel(toStatus);
  }
}

/** Consecuencia automática de una transición, cuando el título nombra la acción de
 * una persona y el cambio de estado en sí queda implícito — hoy solo la aceptación
 * del receptor, que publica el envío en el mismo paso. Devuelve `null` cuando el
 * título ya dice todo (la mayoría de los casos). */
export function shipmentEventDetail(
  toStatus: ShipmentStatus,
  fromStatus: ShipmentStatus | null,
): string | null {
  if (
    fromStatus === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
    toStatus === ShipmentStatus.PUBLISHED
  ) {
    return "Publicado para transportistas";
  }
  return null;
}

/** Camino feliz del ciclo de vida, en orden — el mismo grafo de
 * `shipment-state-machine.ts` (`svc-shipments`, MOVO-105) recorrido por su rama sin
 * incidentes. Los estados terminales por excepción (`cancelled`,
 * `rejected_by_receiver`, `disputed`) quedan afuera a propósito: no son "el próximo
 * paso" de nada, son salidas. `assignment_pending` sí entra — es un estado que el
 * usuario efectivamente ve mientras se reservan los fondos, no un detalle interno. */
const HAPPY_PATH: readonly ShipmentStatus[] = [
  ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
  ShipmentStatus.PUBLISHED,
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERED,
];

/**
 * Pasos que todavía faltan para llegar a la entrega, para pintarlos en gris apagado
 * al final de la línea de tiempo. Es una proyección, no historial: nunca lleva
 * timestamp ni actor, y un envío que salió del camino feliz (cancelado, rechazado, en
 * disputa) devuelve lista vacía — no tiene sentido prometer "Entrega" debajo de un
 * envío cancelado. `assignment_pending` puede volver a `published` si falla el hold de
 * fondos; buscar el índice del estado actual (en vez de contar transiciones ocurridas)
 * hace que el retroceso vuelva a listar los pasos correctos sin lógica extra.
 */
export function remainingLifecycleSteps(currentStatus: ShipmentStatus): ShipmentStatus[] {
  const index = HAPPY_PATH.indexOf(currentStatus);
  if (index === -1) return [];
  return HAPPY_PATH.slice(index + 1);
}

/** Etiqueta de un paso que todavía no ocurrió — en infinitivo/sustantivo ("Retiro del
 * paquete") en vez del pasado de `shipmentEventTitle` ("El paquete salió en camino"):
 * un paso futuro descrito en pasado se lee como algo que ya pasó. */
export function shipmentPendingStepLabel(
  status: ShipmentStatus,
  options?: { receiverName?: string | null; isReceiver?: boolean },
): string {
  const receiver = options?.receiverName;
  switch (status) {
    // Nombrado por la acción que falta (que el receptor acepte), no por el estado que
    // se alcanza — es lo que el emisor está esperando mientras el envío sigue en
    // `awaiting_receiver_confirmation`; la publicación es la consecuencia.
    case ShipmentStatus.PUBLISHED:
      if (options?.isReceiver) return "Tu confirmación";
      return receiver ? `Aceptación de ${receiver}` : "Aceptación del receptor";
    case ShipmentStatus.ASSIGNMENT_PENDING:
      return "Búsqueda de transportista";
    case ShipmentStatus.ASSIGNED:
      return "Asignación del transportista";
    case ShipmentStatus.IN_TRANSIT:
      return "Retiro del paquete";
    case ShipmentStatus.DELIVERED:
      if (options?.isReceiver) return "Entrega del paquete";
      return receiver ? `Entrega a ${receiver}` : "Entrega al receptor";
    default:
      return shipmentStatusLabel(status, { isReceiver: options?.isReceiver });
  }
}

const EVENT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** `createdAt` de un evento viaja como ISO datetime completo (con offset), a
 * diferencia de `pickupDate` — acá sí se parsea con `new Date` y se muestra en la
 * zona horaria del dispositivo, que es la correcta para "cuándo pasó esto". Devuelve
 * `null` ante una fecha inválida para que el caller decida qué mostrar, nunca
 * "Invalid Date". */
export function formatEventTimestamp(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return EVENT_TIMESTAMP_FORMATTER.format(date);
}

/** Quién disparó la transición, resuelto contra los ids que ya tiene el envío en vez
 * de pedir el perfil de `actorId` (`GET /users/:id`) — el rol es lo informativo en una
 * línea de tiempo, y el nombre de la contraparte ya se muestra en `CounterpartCard`.
 * `null` = sin actor humano (transición automática del sistema) o un actor que no es
 * ninguna de las tres partes (un admin resolviendo una disputa). */
export function shipmentActorLabel(
  actorId: string | null,
  parties: { senderId: string; receiverId: string; carrierId: string | null },
  currentUserId: string | null,
  options?: { receiverName?: string | null },
): string | null {
  if (actorId === null) return null;
  if (currentUserId !== null && actorId === currentUserId) return "Vos";
  if (actorId === parties.senderId) return "El emisor";
  if (actorId === parties.receiverId) return options?.receiverName || "El receptor";
  if (parties.carrierId !== null && actorId === parties.carrierId) return "El transportista";
  return "Equipo Movo";
}

/** Recorta una dirección completa a su primer segmento, antes de la primera coma —
 * "Av. Colón 1234, Córdoba" → "Av. Colón 1234" (MOVO-127, card de `ShipmentCard`). El
 * modelo no tiene un campo de barrio separado, así que la calle es el identificador
 * más corto y reconocible disponible para una mini-ruta de dos puntos. */
export function shortAddressLabel(address: string): string {
  return address.split(",")[0].trim();
}

/** Normaliza un string de hora a formato "HH:MM", eliminando segundos si vienen ("09:00:00" -> "09:00"). */
export function formatTimeHHMM(time: string | null | undefined): string {
  if (!time) return "";
  const match = time.match(/^(\d{1,2}:\d{2})/);
  return match ? match[1] : time;
}

/** Ventana horaria de retiro formateada para la card de listado (MOVO-127) — deja el
 * rango explícito ("09:00 a 12:00") en vez de inventar frases relativas tipo "antes de
 * las 15h", que requerirían comparar `pickupDate` contra "hoy" y reabrir el mismo
 * riesgo de desfasaje de huso horario que ya documenta `formatPickupDateLabel`. */
export function formatPickupWindowLabel(start: string, end: string): string {
  const s = formatTimeHHMM(start);
  const e = formatTimeHHMM(end);
  if (!s && !e) return "";
  return `${s || "—"} a ${e || "—"}`;
}

/**
 * Formatea el tiempo restante para responder a la confirmación de un envío (MOVO-131 / MOVO-130).
 * Calcula el plazo en horas entre `deadlineIso` y `now` (por defecto `new Date()`).
 * Si el campo es nulo, indefinido, inválido o el plazo ya expiró (<= 0), devuelve `null`
 * para degradar silenciosamente.
 *
 * Ejemplos:
 * - 36 horas restantes -> "Te quedan 36 h para confirmar"
 * - 1 hora restante -> "Te queda 1 h para confirmar"
 */
export function formatReceiverConfirmationDeadline(
  deadlineIso: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!deadlineIso) return null;
  const deadlineDate = new Date(deadlineIso);
  const timeMs = deadlineDate.getTime();
  if (Number.isNaN(timeMs)) return null;

  const diffMs = timeMs - now.getTime();
  if (diffMs <= 0) return null;

  const hours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (hours <= 0) return null;
  if (hours === 1) return "Te queda 1 h para confirmar";
  return `Te quedan ${hours} h para confirmar`;
}

/**
 * Texto de tiempo secundario para cada fila en la sección "Actividad reciente" (diseño 1-b).
 *
 * Lógica por caso:
 * - `IN_TRANSIT`: "llega HH:MM" usando `pickupTimeWindowEnd` — lo que le importa al usuario
 *   en ese estado es cuándo llega, no cuándo cambió el estado.
 * - < 60 min desde `lastStatusChangedAt` (o `createdAt` como fallback): "hace N min".
 * - Entre 1 h y 24 h: "hace N h".
 * - Ayer (en la zona local del dispositivo): "ayer, HH:MM".
 * - Más antiguo: fecha corta "D MMM" en español.
 *
 * Devuelve `""` ante fechas inválidas — el caller puede omitir el elemento de texto.
 */
export function formatShipmentRowTime(
  shipment: Pick<
    import("../api/shipments-client").ShipmentSummary,
    "status" | "pickupTimeWindowEnd" | "lastStatusChangedAt" | "createdAt"
  >,
  now: Date = new Date(),
): string {
  if (shipment.status === ShipmentStatus.IN_TRANSIT && shipment.pickupTimeWindowEnd) {
    return `llega ${formatTimeHHMM(shipment.pickupTimeWindowEnd)}`;
  }

  const referenceIso = shipment.lastStatusChangedAt ?? shipment.createdAt;
  const ref = new Date(referenceIso);
  if (Number.isNaN(ref.getTime())) return "";

  const diffMs = now.getTime() - ref.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000));

  if (diffMin < 60) return `hace ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;

  // ¿Es ayer en la zona local del dispositivo?
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    ref.getDate() === yesterday.getDate() &&
    ref.getMonth() === yesterday.getMonth() &&
    ref.getFullYear() === yesterday.getFullYear()
  ) {
    const hh = String(ref.getHours()).padStart(2, "0");
    const mm = String(ref.getMinutes()).padStart(2, "0");
    return `ayer, ${hh}:${mm}`;
  }

  return ref.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}
