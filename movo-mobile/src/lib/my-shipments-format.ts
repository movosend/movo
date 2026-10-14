import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { toArgentinaCalendarDateString } from "@movo/shared/dist/utils/argentina-date";
import type { ShipmentSummary } from "../api/shipments-client";
import {
  formatPickupDayLabel,
  formatShipmentPrice,
  isPickupWindowExpired,
  redesignationDeadlineLabel,
  shipmentLifecycleStage,
  shipmentStatusLabel,
  pickupLocalityLabel,
  shortAddressLabel,
} from "./shipment-format";

/**
 * Presentación de "Mis envíos" (MOVO-257, prototipo de Claude Design "Mis envíos 4a"):
 * lógica pura, sin React, para que la pantalla solo pinte. Emisor y receptor, nunca
 * transportista — `GET /shipments/mine` no lista envíos donde el usuario es solo
 * `carrierId`.
 */

export type MyShipmentRole = "sending" | "receiving";
export type MyShipmentsStage = "ongoing" | "history";
export type MyShipmentPillTone = "ink" | "live" | "warning" | "success" | "danger" | "neutral";

/** Destino de la franja de acción: cada caso abre la pantalla donde se resuelve. */
export type MyShipmentStripTarget = "detail" | "offers" | "change_receiver";

export interface MyShipmentStrip {
  /** `action` = lima (hay algo para hacer), `warning` = advertencia (por vencer). */
  kind: "action" | "warning";
  text: string;
  target: MyShipmentStripTarget;
}

export interface MyShipmentPresentation {
  role: MyShipmentRole;
  stage: MyShipmentsStage;
  counterpartId: string;
  /** Destino si el usuario envía, origen si recibe (lo que identifica al envío). */
  title: string;
  /** "Hoy" / "Mañana" / "mié 30" (en curso, fecha de retiro) o "jue 24" (historial,
   * fecha de cierre). */
  dayLabel: string;
  price: string;
  priceCaption: "aprox." | "pactado";
  /** Etiqueta en mayúsculas del prototipo; `null` cuando el estado va como texto gris. */
  pill: { label: string; tone: MyShipmentPillTone } | null;
  /** Texto gris "· Publicado" del prototipo, para estados sin nada que hacer. */
  quietStatus: string | null;
  strip: MyShipmentStrip | null;
  /** Clave del filtro de Estado y su etiqueta — los mismos nombres que la fila. */
  statusKey: string;
  statusLabel: string;
}

/** Retiro dentro de esta ventana, publicado y sin ofertas: franja de "por vencer". */
export const EXPIRING_WITHOUT_OFFERS_WINDOW_MS = 24 * 60 * 60 * 1000;

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export function myShipmentRole(shipment: Pick<ShipmentSummary, "senderId">, userId: string): MyShipmentRole {
  return shipment.senderId === userId ? "sending" : "receiving";
}

export function myShipmentCounterpartId(
  shipment: Pick<ShipmentSummary, "senderId" | "receiverId">,
  role: MyShipmentRole,
): string {
  return role === "sending" ? shipment.receiverId : shipment.senderId;
}

export function myShipmentStage(shipment: ShipmentSummary, userId: string): MyShipmentsStage {
  // MOVO-275: le pasó la recepción a otra persona, no tiene nada pendiente con este envío.
  if (shipment.transferredByMe) return "history";
  const isReceiver = shipment.receiverId === userId;
  return shipmentLifecycleStage(shipment.status, { isReceiver }) === "past" ? "history" : "ongoing";
}

/** Instante de inicio de la ventana de retiro, en la zona del dispositivo — mismo
 * criterio que `isPickupWindowExpired` para el cierre. */
function pickupWindowStart(shipment: Pick<ShipmentSummary, "pickupDate" | "pickupTimeWindowStart">): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shipment.pickupDate)) return null;
  const [year, month, day] = shipment.pickupDate.split("-").map(Number);
  const match = shipment.pickupTimeWindowStart.match(/^(\d{1,2}):(\d{2})/);
  const [hour, minute] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  return new Date(year, month - 1, day, hour, minute);
}

/** Publicado por el usuario, sin ofertas vigentes y con el retiro a menos de 24 h.
 * Solo avisa: no hay endpoint para cambiar los días de un envío publicado. */
export function isExpiringWithoutOffers(
  shipment: ShipmentSummary,
  role: MyShipmentRole,
  now: Date = new Date(),
): boolean {
  if (role !== "sending" || shipment.status !== ShipmentStatus.PUBLISHED) return false;
  if (shipment.pendingOffersCount !== 0) return false;
  if (isPickupWindowExpired(shipment.pickupDate, shipment.pickupTimeWindowEnd, now)) return false;
  const start = pickupWindowStart(shipment);
  return start !== null && start.getTime() - now.getTime() <= EXPIRING_WITHOUT_OFFERS_WINDOW_MS;
}

/** "jue 24" a partir de un instante ISO, en calendario argentino. */
function shortDayFromInstant(iso: string): string {
  const dateStr = toArgentinaCalendarDateString(iso);
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
}

/** Cuándo cerró el envío (entregado/cancelado/rechazado), para el historial. */
export function myShipmentClosedAt(
  shipment: Pick<ShipmentSummary, "lastStatusChangedAt" | "updatedAt" | "transferredByMe">,
): string {
  // MOVO-275: para quien transfirió, el envío "cerró" cuando se lo pasó a otra persona.
  if (shipment.transferredByMe) return shipment.transferredByMe.at;
  return shipment.lastStatusChangedAt ?? shipment.updatedAt;
}

function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function presentMyShipment(
  shipment: ShipmentSummary,
  userId: string,
  options: { counterpartName?: string | null; now?: Date } = {},
): MyShipmentPresentation {
  const now = options.now ?? new Date();
  const role = myShipmentRole(shipment, userId);
  const stage = myShipmentStage(shipment, userId);
  const counterpart = firstName(options.counterpartName);
  const sending = role === "sending";

  const base = {
    role,
    stage,
    counterpartId: myShipmentCounterpartId(shipment, role),
    // El receptor ve el origen solo como localidad, nunca la calle de retiro (MOVO-194 AC4,
    // mismo dato que el detalle del envío).
    title: sending
      ? shortAddressLabel(shipment.deliveryAddress)
      : (pickupLocalityLabel(shipment.pickupAddress) ?? (counterpart ? `Envío de ${counterpart}` : "Envío para vos")),
    dayLabel:
      stage === "history"
        ? shortDayFromInstant(myShipmentClosedAt(shipment))
        : formatPickupDayLabel(shipment.pickupDate, now, { includeMonth: false }),
    price: formatShipmentPrice(shipment.agreedPriceArs, shipment.suggestedPriceArs),
    priceCaption: (shipment.agreedPriceArs != null ? "pactado" : "aprox.") as "pactado" | "aprox.",
  };

  const quiet = (statusKey: string, label: string, strip: MyShipmentStrip | null = null): MyShipmentPresentation => ({
    ...base,
    pill: null,
    quietStatus: label,
    strip,
    statusKey,
    statusLabel: label,
  });
  const withPill = (
    statusKey: string,
    statusLabel: string,
    pill: { label: string; tone: MyShipmentPillTone },
    strip: MyShipmentStrip | null = null,
  ): MyShipmentPresentation => ({ ...base, pill, quietStatus: null, strip, statusKey, statusLabel });

  // MOVO-275: le pasó la recepción a otra persona (ve el envío en solo lectura).
  if (shipment.transferredByMe) {
    return withPill("transferred", "Transferido", { label: "TRANSFERIDO", tone: "neutral" });
  }

  switch (shipment.status) {
    case ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION:
      if (!sending) {
        return withPill("accept", "Aceptá", { label: "ACEPTÁ", tone: "ink" }, {
          kind: "action",
          text: counterpart ? `${counterpart} te manda un paquete. Aceptalo.` : "Te mandan un paquete. Aceptalo.",
          target: "detail",
        });
      }
      return quiet("awaiting_receiver", "Esperando receptor");

    case ShipmentStatus.PUBLISHED: {
      const offers = shipment.pendingOffersCount ?? 0;
      if (sending && offers > 0) {
        return withPill(
          "offers",
          "Con ofertas",
          { label: offers === 1 ? "1 OFERTA" : `${offers} OFERTAS`, tone: "ink" },
          {
            kind: "action",
            text: offers === 1 ? "Tenés 1 oferta. Elegí quién lo lleva." : `Tenés ${offers} ofertas. Elegí quién lo lleva.`,
            target: "offers",
          },
        );
      }
      if (isExpiringWithoutOffers(shipment, role, now)) {
        const when = base.dayLabel === "Hoy" ? "es hoy" : base.dayLabel === "Mañana" ? "es mañana" : "se acerca";
        return quiet("published", "Publicado", {
          kind: "warning",
          text: `Nadie lo tomó todavía y el retiro ${when}. Si no llegan ofertas, se cancela solo.`,
          target: "detail",
        });
      }
      return quiet("published", "Publicado");
    }

    case ShipmentStatus.REJECTED_BY_RECEIVER: {
      if (stage === "history") {
        return withPill("rejected", "Rechazado", { label: "RECHAZADO", tone: "danger" });
      }
      // MOVO-253: el emisor elige a otra persona mientras siga el plazo.
      const deadline = redesignationDeadlineLabel(shipment.receiverRedesignationDeadline, now);
      if (!deadline) return quiet("rejected", "Rechazado");
      const who = counterpart ?? "El receptor";
      return withPill("choose_receiver", "Elegí receptor", { label: "ELEGÍ RECEPTOR", tone: "ink" }, {
        kind: "action",
        text: `${who} no aceptó el envío. ${deadline} para elegir a otra persona.`,
        target: "change_receiver",
      });
    }

    case ShipmentStatus.IN_TRANSIT:
      return withPill("in_transit", "En camino", { label: "EN CAMINO", tone: "live" });

    case ShipmentStatus.DISPUTED:
      return withPill("disputed", "En disputa", { label: "EN DISPUTA", tone: "warning" });

    case ShipmentStatus.DELIVERED:
    case ShipmentStatus.COMPLETED:
      return withPill("delivered", "Entregado", { label: "ENTREGADO", tone: "success" });

    case ShipmentStatus.CANCELLED:
      return withPill("cancelled", "Cancelado", { label: "CANCELADO", tone: "danger" });

    case ShipmentStatus.ASSIGNMENT_PENDING:
    case ShipmentStatus.ASSIGNED_UNFUNDED:
    case ShipmentStatus.ASSIGNED:
    default: {
      const label = shipmentStatusLabel(shipment.status);
      return quiet(shipment.status, label);
    }
  }
}

/** Primero los que esperan algo del usuario, después por fecha y hora de retiro. */
export function compareOngoing(
  a: { shipment: ShipmentSummary; presentation: MyShipmentPresentation },
  b: { shipment: ShipmentSummary; presentation: MyShipmentPresentation },
): number {
  const aAction = a.presentation.strip ? 1 : 0;
  const bAction = b.presentation.strip ? 1 : 0;
  if (aAction !== bAction) return bAction - aAction;
  const aKey = `${a.shipment.pickupDate} ${a.shipment.pickupTimeWindowStart}`;
  const bKey = `${b.shipment.pickupDate} ${b.shipment.pickupTimeWindowStart}`;
  return aKey.localeCompare(bKey);
}

/** Historial agrupado por mes de cierre, más reciente primero. El año se agrega solo
 * si no es el actual ("Diciembre 2025"). */
export function groupHistoryByMonth<T extends { shipment: ShipmentSummary }>(
  items: T[],
  now: Date = new Date(),
): Array<{ month: string; items: T[] }> {
  const currentYear = Number(toArgentinaCalendarDateString(now).slice(0, 4));
  const sorted = [...items].sort((a, b) =>
    myShipmentClosedAt(b.shipment).localeCompare(myShipmentClosedAt(a.shipment)),
  );
  const groups: Array<{ month: string; items: T[] }> = [];
  for (const item of sorted) {
    const [y, m] = toArgentinaCalendarDateString(myShipmentClosedAt(item.shipment)).split("-").map(Number);
    const month = y === currentYear ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

export function activeCountLabel(count: number): string {
  return `${count} ${count === 1 ? "activo" : "activos"}`;
}

export function ongoingListTitle(count: number, role: MyShipmentRole | "all"): string {
  if (role === "sending") return `${count} que enviás`;
  if (role === "receiving") return `${count} que recibís`;
  return `${count} en curso`;
}

/** Personas con las que el usuario tiene envíos (la otra parte de cada uno), de la
 * más frecuente a la menos. Con un rol elegido, solo las de ese rol. */
export function personIdsByFrequency(
  items: Array<{ presentation: MyShipmentPresentation }>,
  role: MyShipmentRole | "all",
): string[] {
  const counts = new Map<string, number>();
  for (const { presentation } of items) {
    if (role !== "all" && presentation.role !== role) continue;
    counts.set(presentation.counterpartId, (counts.get(presentation.counterpartId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Opciones del filtro de Estado: solo las que aparecen en la pestaña, en el orden
 * en que se listan. */
export function statusFilterOptions(
  items: Array<{ presentation: MyShipmentPresentation }>,
): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const { presentation } of items) {
    if (!seen.has(presentation.statusKey)) seen.set(presentation.statusKey, presentation.statusLabel);
  }
  return [...seen.entries()].map(([id, label]) => ({ id, label }));
}
