import { OfferStatus } from "@movo/shared/dist/types/offer";
import type { OfferCompetitiveRank } from "../api/offers-client";
import { formatPriceArs } from "./shipment-format";

/**
 * Copy explicativo por estado EFECTIVO de una oferta (AC1 de MOVO-182, mismo criterio
 * que AC3 de MOVO-151 y `shipmentStatusLabel`): nunca el enum crudo. El backend ya
 * deriva `expired` en cada lectura (ver comentario de `OfferStatus` en
 * `@movo/shared`), así que `status` acá siempre es el efectivo -- sin lógica extra de
 * derivación del lado del cliente.
 */
const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  [OfferStatus.PENDING]: "Pendiente",
  [OfferStatus.ACCEPTED]: "Aceptada",
  [OfferStatus.REJECTED]: "Rechazada",
  [OfferStatus.WITHDRAWN]: "La retiraste",
  [OfferStatus.EXPIRED]: "Venció antes de que respondieran",
  [OfferStatus.SUPERSEDED]: "El emisor eligió otra oferta",
};

export function offerStatusLabel(status: OfferStatus): string {
  return OFFER_STATUS_LABEL[status];
}

export interface OfferStatusBannerCopy {
  title: string;
  subtitle: string;
  tone: "neutral" | "positive" | "negative";
}

/**
 * Banner de estado de la pantalla de detalle (AC1) -- título + explicación, sin
 * exponer el enum. `senderFirstName`/`viewedLabel` alimentan el copy de `pending`
 * ("Esperando a Pedro. Todavía no la vio.").
 */
export function offerStatusBannerCopy(
  status: OfferStatus,
  ctx: {
    senderFirstName?: string | null;
    viewedLabel?: string;
  } = {},
): OfferStatusBannerCopy {
  const senderName = ctx.senderFirstName?.trim();
  const sender = senderName || "el emisor";

  switch (status) {
    case OfferStatus.PENDING:
      return {
        title: senderName ? `Esperando a ${senderName}` : "Esperando al emisor",
        subtitle: `${ctx.viewedLabel ?? "Todavía no la vio"}. Podés cambiar el precio o retirarla mientras no responda.`,
        tone: "neutral",
      };
    case OfferStatus.ACCEPTED:
      return {
        title: "Te la aceptaron",
        subtitle: "El pago quedó retenido por Movo. Confirmá el retiro y arrancá el viaje.",
        tone: "positive",
      };
    case OfferStatus.REJECTED:
      return {
        title: "No la tomó",
        subtitle: `Tu horario no coincidía con lo que pidió ${sender}. Podés ofertar en otros envíos parecidos.`,
        tone: "negative",
      };
    case OfferStatus.SUPERSEDED:
      return {
        title: "El envío se cerró con otro transportista",
        subtitle: `${sender} eligió otra oferta para este envío.`,
        tone: "neutral",
      };
    case OfferStatus.EXPIRED:
      return {
        title: "Venció sin respuesta",
        subtitle: `Pasó la fecha de retiro y ${sender} nunca contestó.`,
        tone: "neutral",
      };
    case OfferStatus.WITHDRAWN:
      return {
        title: "La retiraste vos",
        subtitle: "Salió de la lista del emisor. Este envío ya no acepta ofertas tuyas.",
        tone: "neutral",
      };
  }
}

/**
 * "Vista hace 40 min" / "Todavía no la vio" (MOVO-189) -- mismo patrón de tiempo
 * relativo que `formatShipmentRowTime` (`shipment-format.ts`), acotado a min/h (el
 * historial de una oferta no vive semanas).
 */
export function formatViewedBySender(
  viewedAtBySender: string | null,
  now: Date = new Date(),
): string {
  if (!viewedAtBySender) return "Todavía no la vio";

  const viewed = new Date(viewedAtBySender);
  if (Number.isNaN(viewed.getTime())) return "Todavía no la vio";

  const diffMin = Math.max(0, Math.floor((now.getTime() - viewed.getTime()) / 60_000));
  if (diffMin <= 1) return "La vio recién";
  if (diffMin < 60) return `Vista hace ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Vista hace ${diffH} h`;

  const diffDays = Math.floor(diffH / 24);
  return `Vista hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
}

/**
 * "Enviada hace 2 h" -- mismo patrón acotado a min/h/días que `formatViewedBySender`,
 * para la card de dinero del detalle (`d.sentAgo` del mockup).
 */
export function formatSentAgo(createdAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";

  const diffMin = Math.max(0, Math.floor((now.getTime() - created.getTime()) / 60_000));
  if (diffMin <= 1) return "Recién";
  if (diffMin < 60) return `hace ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;

  const diffDays = Math.floor(diffH / 24);
  return `hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
}

/** "4.º" -- mismo formato que usaba el mockup para "Cómo venís". */
export function ordinalLabel(rank: number): string {
  return `${rank}.º`;
}

/**
 * "Quedaste 4.º de 5. Bajando a $X pasás al frente." (MOVO-151, sección "Requieren
 * algo tuyo" de "Mis ofertas") -- aviso accionable para una oferta `pending` que no
 * lidera el ranking competitivo (MOVO-188). `null` cuando ya lidera (`rank === 1`):
 * ahí no hay ninguna acción que sugerirle, mismo criterio que la sección "Cómo venís"
 * del detalle (`offer-detail-rank-section`), que tampoco sugiere bajar el precio.
 */
export function competitiveRankNotice(rank: OfferCompetitiveRank): string | null {
  if (rank.rank === 1) return null;
  return `Quedaste ${ordinalLabel(rank.rank)} de ${rank.total}. Bajando a ${formatPriceArs(rank.lowestPriceNetArs)} pasás al frente.`;
}

/**
 * `offeredPickupTimeWindowStart/End: null` significa "la oferta usa la ventana del
 * envío tal cual" (ver el comentario de `OfferSummary` en `offers-client.ts`) -- el
 * transportista solo los completa desde el modo "Proponer otro día u horario" del
 * paso 2 de crear/editar oferta (`app/(app)/transport/[id]/offer.tsx`), que siempre
 * manda `offeredDate` y la franja juntos. Por eso alcanza con mirar la franja: no
 * hace falta comparar fecha por separado para decidir si coincide.
 */
export function offerPickupMatchesRequest(offer: {
  offeredPickupTimeWindowStart: string | null;
  offeredPickupTimeWindowEnd: string | null;
}): boolean {
  return !offer.offeredPickupTimeWindowStart && !offer.offeredPickupTimeWindowEnd;
}
