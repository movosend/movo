import type {
  TransactionDetail,
  TransactionListItem,
  TransactionMovement,
  TransactionRole,
  TransactionStatus,
} from "@movo/shared/dist/types/transaction";
import { toArgentinaCalendarDateString, toArgentinaTimeOfDayString } from "@movo/shared/dist/utils/argentina-date";
import { activeShipmentDisplayCode } from "./active-shipment-format";
import { cardBrandName, paymentTypeLabel, shortBankName } from "./saved-cards";
import { formatPriceArs } from "./shipment-format";

/**
 * Presentación del historial de pagos y cobros (MOVO-304), pura y testeable. Es la ÚNICA
 * fuente de las etiquetas de estado (AC7): la lista, el detalle y los filtros salen de acá.
 * Los textos salen del canvas de Claude Design "MOVO-28 Historial de pagos y cobros".
 */

/** Orden de los estados en la hoja de filtros (el del canvas). */
export const TRANSACTION_STATUS_ORDER: readonly TransactionStatus[] = [
  "reserved",
  "completed",
  "refunded",
  "disputed",
  "released",
];

const STATUS_LABELS: Record<TransactionStatus, string> = {
  reserved: "Reservado",
  completed: "Completado",
  refunded: "Reembolsado",
  disputed: "En disputa",
  released: "Liberado",
};

/** En Cobros "Completado" se muestra como "Cobrado"; el resto del set es el mismo (AC6). */
export function transactionStatusLabel(status: TransactionStatus, role: TransactionRole): string {
  if (status === "completed" && role === "carrier") return "Cobrado";
  return STATUS_LABELS[status];
}

/** Estilos de la pill por estado (AC6). Los colores `dark:` mantienen el contraste en modo oscuro. */
export const TRANSACTION_PILL_CLASSES: Record<TransactionStatus, { container: string; text: string }> = {
  reserved: { container: "bg-ink-950 dark:border dark:border-lime-500", text: "text-lime-500" },
  completed: { container: "bg-lime-500", text: "text-ink-950" },
  refunded: { container: "border-[1.5px] border-ink-950 dark:border-paper", text: "text-ink-950 dark:text-paper" },
  disputed: { container: "border-[1.5px] border-danger-600 dark:border-danger-400", text: "text-danger-600 dark:text-danger-400" },
  released: { container: "bg-ink-150 dark:bg-ink-700", text: "text-ink-600 dark:text-ink-200" },
};

/** Monto en pesos; nunca "NaN" ni "$0" inventado si el dato no es un número finito. */
export function formatTransactionAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return formatPriceArs(value);
}

export function transactionDisplayCode(shipmentId: string): string {
  return activeShipmentDisplayCode(shipmentId);
}

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function parseDay(day: string): { year: number; month: number; date: number } {
  const [year, month, date] = day.split("-").map(Number);
  return { year, month, date };
}

/** "13 oct" — día calendario en hora de Argentina, nunca el del huso del dispositivo. */
export function formatShortDate(iso: string): string {
  const { month, date } = parseDay(toArgentinaCalendarDateString(iso));
  return `${date} ${MONTHS_SHORT[month - 1]}`;
}

/** "4 oct 2026 · 14:32" en hora de Argentina. */
export function formatDateTime(iso: string): string {
  const { year, month, date } = parseDay(toArgentinaCalendarDateString(iso));
  return `${date} ${MONTHS_SHORT[month - 1]} ${year} · ${toArgentinaTimeOfDayString(iso)}`;
}

/** "4 oct · 14:32" en hora de Argentina (la línea de tiempo del detalle, sin el año). */
export function formatShortDateTime(iso: string): string {
  return `${formatShortDate(iso)} · ${toArgentinaTimeOfDayString(iso)}`;
}

/** "1 oct 2026" para un `YYYY-MM-DD` ya armado (filtros). */
export function formatFilterDay(day: string): string {
  const { year, month, date } = parseDay(day);
  return `${date} ${MONTHS_SHORT[month - 1]} ${year}`;
}

export interface TransactionMonthSection {
  /** `YYYY-MM`. */
  key: string;
  /** "Octubre 2026". */
  label: string;
  items: TransactionListItem[];
}

/**
 * Agrupa por mes (en hora de Argentina) conservando el orden que ya trae el backend
 * (`created_at DESC`): el mes más reciente primero. Una página siguiente que continúa un mes
 * ya abierto se suma a esa misma sección.
 */
export function groupTransactionsByMonth(items: readonly TransactionListItem[]): TransactionMonthSection[] {
  const sections: TransactionMonthSection[] = [];
  for (const item of items) {
    const { year, month } = parseDay(toArgentinaCalendarDateString(item.date));
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      sections.push({ key, label: `${MONTHS_LONG[month - 1]} ${year}`, items: [item] });
    }
  }
  return sections;
}

/** Título de la fila y del detalle: el envío, o "Pago de tu saldo" (un pago de la cuenta corriente, sin envío). */
export function transactionTitle(item: Pick<TransactionListItem, "kind" | "shipmentId" | "destinationLabel">): string {
  if (item.kind === "balance_payment" || !item.shipmentId) return "Pago de tu saldo";
  // Como el resto de la app, el envío se nombra por su destino; el código queda de respaldo si no se pudo resolver.
  return item.destinationLabel ? `Envío a ${item.destinationLabel}` : `Envío ${transactionDisplayCode(item.shipmentId)}`;
}

/**
 * Cuánto de la transacción es deuda de la cuenta corriente, para que el historial cierre con Saldo:
 * el recargo que el emisor pagó con el envío, o lo que se descontó del cobro del transportista.
 */
export function debtLine(item: Pick<TransactionListItem, "debtAmountArs">, role: TransactionRole): string | null {
  if (item.debtAmountArs === null || item.debtAmountArs === undefined || !Number.isFinite(item.debtAmountArs)) return null;
  const amount = formatTransactionAmount(item.debtAmountArs);
  return role === "sender" ? `Incluye ${amount} de tu saldo` : `Se descontaron ${amount} de tu saldo`;
}

/** "Reembolso de $1.500" (AC4), o `null` si la transacción no tiene reembolso. */
export function refundLine(item: Pick<TransactionListItem, "refundedAmountArs">): string | null {
  if (item.refundedAmountArs === null || !Number.isFinite(item.refundedAmountArs)) return null;
  return `Reembolso de ${formatTransactionAmount(item.refundedAmountArs)}`;
}

/** "Visa •••• 4242", o solo la marca si MP todavía no informó los últimos 4. */
export function transactionCardLabel(card: TransactionListItem["card"]): string | null {
  if (!card) return null;
  return card.last4 ? `${cardBrandName(card.brand)} •••• ${card.last4}` : cardBrandName(card.brand);
}

/** Lo que se lee primero del método de pago: el nombre de referencia de la tarjeta guardada, o marca y últimos 4. */
export function transactionCardTitle(card: NonNullable<TransactionListItem["card"]>): string {
  return card.alias?.trim() || transactionCardLabel(card) || "Tarjeta";
}

/** "Visa •••• 3704 · Galicia · Crédito": con nombre de referencia suma marca y últimos 4 adelante, sin repetirlos si no. */
export function transactionCardMeta(card: NonNullable<TransactionListItem["card"]>): string {
  const bank = card.issuerName ? shortBankName(card.issuerName) : null;
  return [card.alias?.trim() ? transactionCardLabel(card) : null, bank, paymentTypeLabel(card.paymentType)]
    .filter(Boolean)
    .join(" · ");
}

export interface TimelineEvent {
  key: string;
  title: string;
  detail: string;
  /** Todavía no pasó: se muestra apagado, para que se vea qué viene después. */
  pending?: boolean;
}

/**
 * Línea de tiempo del pago del emisor (AC10), con día y hora de cada hito: la reserva, y después el cobro al entregar,
 * la liberación sin cobrar (con su motivo) o, mientras no pasó ninguna de las dos, el paso que falta. Los reembolsos y
 * disputas se agregan aparte (`movementCopy`).
 */
export function senderTimeline(detail: TransactionDetail): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      key: "reserved",
      title: "Fondos reservados",
      detail: `${formatShortDateTime(detail.date)} · ${formatTransactionAmount(detail.amountArs)}`,
    },
  ];
  if (detail.capturedAt) {
    events.push({
      key: "captured",
      title: "Pago cobrado",
      detail: `${formatShortDateTime(detail.capturedAt)} · al entregarse el envío`,
    });
  } else if (detail.status === "released") {
    const why = detail.releaseReason === "expired" ? "La reserva venció"
      : detail.releaseReason === "cancelled" ? "El envío se canceló" : null;
    events.push({
      key: "released",
      title: "Reserva liberada",
      detail: `${detail.releasedAt ? `${formatShortDateTime(detail.releasedAt)} · ` : ""}${why ? `${why}. ` : ""}No se te cobró nada`,
    });
  } else if (detail.status === "reserved") {
    events.push({
      key: "pending-capture",
      title: "Cobro al entregar",
      detail: "Se cobra cuando se entregue el envío",
      pending: true,
    });
  }
  return events;
}

const CARRIER_NOTES: Record<TransactionStatus, string> = {
  reserved: "Se acredita al entregar",
  completed: "Acreditado",
  refunded: "Reembolsado al emisor",
  disputed: "Hay una disputa abierta",
  released: "Reserva liberada",
};

/** Segunda línea de la fila: tarjeta y fecha en Pagos, situación del cobro y fecha en Cobros. */
export function transactionRowSubtitle(item: TransactionListItem, role: TransactionRole): string {
  const date = formatShortDate(item.date);
  if (role === "sender") {
    const card = transactionCardLabel(item.card);
    return card ? `${card} · ${date}` : date;
  }
  return item.status === "completed"
    ? `${CARRIER_NOTES[item.status]} · reserva del ${date}`
    : `${CARRIER_NOTES[item.status]} · ${date}`;
}

/**
 * Rótulo del hero del detalle. El transportista ve "Te acreditaron" (el neto) solo cuando la
 * liquidación está acreditada y hay desglose (`hasNet`); en cualquier otro estado el hero
 * muestra lo que pagó el emisor y nunca un neto (AC11).
 */
export function transactionHeroLabel(status: TransactionStatus, role: TransactionRole, hasNet = false, captured = false): string {
  if (role === "sender") return status === "released" || (status === "reserved" && !captured) ? "Reservaste" : "Pagaste";
  return hasNet ? "Te acreditaron" : "Pagó el emisor";
}

export const TRANSACTION_NOT_FOUND_MESSAGE = "No encontramos esta transacción";

/** Pill del hero: un reembolso parcial lo aclara; el resto usa la etiqueta única. */
export function transactionHeroPill(
  item: Pick<TransactionListItem, "status" | "refundedAmountArs" | "amountArs">,
  role: TransactionRole,
): string {
  if (
    item.status === "refunded" &&
    item.refundedAmountArs !== null &&
    Number.isFinite(item.refundedAmountArs) &&
    item.refundedAmountArs < item.amountArs
  ) {
    return "Reembolsado parcialmente";
  }
  return transactionStatusLabel(item.status, role);
}

export interface MovementCopy {
  title: string;
  detail: string;
  /** Movimiento vinculado al pago original (el reembolso): se resalta con el recuadro lima. */
  linkedNote: string | null;
}

/** Texto de un movimiento de la línea de tiempo del detalle (AC10). */
export function movementCopy(
  movement: TransactionMovement,
  paymentAmountArs: number,
  paymentDate: string,
): MovementCopy {
  const date = formatShortDateTime(movement.date);
  const amount = movement.amountArs;
  const hasAmount = amount !== null && Number.isFinite(amount);
  if (movement.kind === "refund") {
    const partial = hasAmount && amount < paymentAmountArs;
    return {
      title: partial ? "Reembolso parcial" : "Reembolso",
      detail: hasAmount ? `${date} · ${formatTransactionAmount(amount)} devueltos a tu tarjeta` : `${date} · Mercado Pago lo informó sin monto`,
      linkedNote: `Vinculado al pago de ${formatTransactionAmount(paymentAmountArs)} del ${formatShortDate(paymentDate)}.`,
    };
  }
  if (movement.kind === "chargeback") {
    return {
      title: "Contracargo",
      detail: hasAmount ? `${date} · ${formatTransactionAmount(amount)}` : date,
      linkedNote: `Vinculado al pago de ${formatTransactionAmount(paymentAmountArs)} del ${formatShortDate(paymentDate)}.`,
    };
  }
  return {
    title: "Mediación abierta",
    detail: hasAmount ? `${date} · ${formatTransactionAmount(amount)}` : date,
    linkedNote: null,
  };
}

// ── Filtros de fecha ────────────────────────────────────────────────────────

function toDayString(year: number, month: number, date: number): string {
  const d = new Date(Date.UTC(year, month - 1, date));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export interface DayRange {
  from: string;
  to: string;
}

export type DatePresetId = "last30" | "thisMonth" | "previousMonth";

export const DATE_PRESETS: readonly { id: DatePresetId; label: string }[] = [
  { id: "last30", label: "Últimos 30 días" },
  { id: "thisMonth", label: "Este mes" },
  { id: "previousMonth", label: "Mes anterior" },
];

/** Rango de un atajo, calculado sobre el día calendario de Argentina (no el del dispositivo). */
export function dateRangeForPreset(id: DatePresetId, now: Date = new Date()): DayRange {
  const { year, month, date } = parseDay(toArgentinaCalendarDateString(now));
  const today = toDayString(year, month, date);
  if (id === "last30") return { from: toDayString(year, month, date - 29), to: today };
  if (id === "thisMonth") return { from: toDayString(year, month, 1), to: today };
  return { from: toDayString(year, month - 1, 1), to: toDayString(year, month, 0) };
}

/** El atajo que coincide con el rango actual, para marcarlo como activo. */
export function matchingDatePreset(
  from: string | null,
  to: string | null,
  now: Date = new Date(),
): DatePresetId | null {
  if (!from || !to) return null;
  return (
    DATE_PRESETS.find((preset) => {
      const range = dateRangeForPreset(preset.id, now);
      return range.from === from && range.to === to;
    })?.id ?? null
  );
}

/** "1 – 14 oct", "1 oct – 3 nov 2026", "Desde 1 oct", "Hasta 14 oct": etiqueta removible del rango. */
export function dateRangeLabel(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  if (from && !to) return `Desde ${formatFilterDay(from)}`;
  if (!from && to) return `Hasta ${formatFilterDay(to)}`;
  const a = parseDay(from!);
  const b = parseDay(to!);
  if (a.year === b.year && a.month === b.month) {
    return a.date === b.date ? `${a.date} ${MONTHS_SHORT[a.month - 1]}` : `${a.date} – ${b.date} ${MONTHS_SHORT[b.month - 1]}`;
  }
  return `${formatFilterDay(from!)} – ${formatFilterDay(to!)}`;
}

/** `Date` local para el selector nativo a partir de un `YYYY-MM-DD`. */
export function dayStringToPickerDate(day: string): Date {
  const { year, month, date } = parseDay(day);
  return new Date(year, month - 1, date);
}

/** `YYYY-MM-DD` de lo que devuelve el selector nativo (componentes locales, sin pasar por UTC). */
export function pickerDateToDayString(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Hoy en Argentina como `YYYY-MM-DD` (tope de los selectores). */
export function todayInArgentina(now: Date = new Date()): string {
  return toArgentinaCalendarDateString(now);
}

/** Copy del vacío por tab (AC13). */
export const TRANSACTION_EMPTY_COPY: Record<
  TransactionRole,
  { title: string; description: string; cta: string }
> = {
  sender: {
    title: "Todavía no hiciste pagos",
    description: "Cuando contrates un envío, vas a ver acá lo que pagaste.",
    cta: "Enviar un paquete",
  },
  carrier: {
    title: "Todavía no cobraste",
    description: "Tus cobros aparecen acá una vez que entregues un envío.",
    cta: "Ver envíos disponibles",
  },
};

export function noResultsTitle(role: TransactionRole): string {
  return role === "sender" ? "Ningún pago coincide" : "Ningún cobro coincide";
}

/** "6 pagos"; con más páginas por cargar es un mínimo ("20+ pagos"), el backend no informa el total. */
export function resultsCountLabel(count: number, role: TransactionRole, hasMore = false): string {
  const plural = count !== 1 || hasMore;
  const noun = role === "sender" ? (plural ? "pagos" : "pago") : plural ? "cobros" : "cobro";
  return `${count}${hasMore ? "+" : ""} ${noun}`;
}
