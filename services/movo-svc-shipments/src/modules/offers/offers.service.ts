import { ApiError, OfferStatus, ShipmentStatus, computeNetFromGross, getCommissionConfig } from "@movo/shared";
import { FastifyBaseLogger } from "fastify";
import { OfferRepository } from "../../repositories/offer-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { NotificationsClient } from "../../adapters/notifications-client";
import { Offer, OfferCompetitiveRank, OfferWithShipmentContext } from "../../models/offer";
import { assertIsSender } from "../shipments/assert-shipment-access";

/** MOVO-188: batch de reputación `asCarrier` (`ratings.service.ts#getCarrierReputationScoresBatch`)
 * inyectado por `offers.routes.ts` -- mismo criterio de callback local (sin HTTP contra
 * sí mismo) que `ShipmentsServiceOptions.getCarrierReputationScore` (MOVO-143), pero en
 * versión batch: acá se necesita el score de TODOS los carriers que compiten en la
 * página a la vez, no de uno solo. */
export type GetCarrierReputationScores = (carrierIds: string[]) => Promise<Map<string, number | null>>;

interface CompetingOffer {
  id: string;
  carrierId: string;
  priceOffered: number;
  createdAt: Date;
}

type OffersServiceLogger =
  | FastifyBaseLogger
  | { info?: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };

interface OfferPushParams {
  carrierId: string;
  title: string;
  body: string;
  shipmentId: string;
  offerId: string;
  type: "offer_accepted" | "offer_superseded" | "offer_rejected";
}

async function dispatchOfferPush(
  notificationsClient: NotificationsClient | undefined,
  logger: OffersServiceLogger | undefined,
  params: OfferPushParams
): Promise<void> {
  if (!notificationsClient) {
    return;
  }
  try {
    await notificationsClient.sendPush({
      userId: params.carrierId,
      title: params.title,
      body: params.body,
      data: { type: params.type, shipmentId: params.shipmentId, offerId: params.offerId },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", shipmentId: params.shipmentId, offerId: params.offerId },
      "No se pudo enviar la push de decisión de oferta"
    );
  }
}

export interface ListMyOffersResult {
  items: OfferWithShipmentContext[];
  page: number;
  limit: number;
  total: number;
}

/**
 * MOVO-188 (fix de review, PR #142): con precios en ARS es COMÚN que varias ofertas
 * coincidan centavo a centavo (redondeo a valores "de punta" tipo 5000/5500) -- un
 * `orderBy: priceOffered` solo no alcanza, Postgres no garantiza qué fila queda
 * primero entre iguales, así que el `rank` podía cambiar solo entre dos llamadas sin
 * que nada cambiara en la realidad. Cascada de desempate (decisión de producto, no
 * pedida por ningún AC de MOVO-188): a igual precio, gana quien tiene mejor
 * reputación `asCarrier` (MOVO-147) -- información real para decidir, no solo orden
 * estable; a igual reputación, quien entregó más envíos como transportista (más
 * historial verificable); a igual todo eso, quien ofertó primero (`createdAt`); el
 * `id` es el piso final, solo para que el orden sea 100% determinístico incluso en el
 * caso de laboratorio de dos ofertas idénticas en todo menos el id.
 *
 * `reputationScore`/`deliveredCount` ausentes (competidor sin datos) valen lo mínimo
 * posible -- no benefician a nadie por que falte su dato, nunca ganan un desempate
 * real por default.
 */
function compareCompetingOffers(
  a: CompetingOffer,
  b: CompetingOffer,
  reputationByCarrier: Map<string, number | null>,
  deliveredCountByCarrier: Map<string, number>
): number {
  if (a.priceOffered !== b.priceOffered) {
    return a.priceOffered - b.priceOffered;
  }
  const reputationA = reputationByCarrier.get(a.carrierId) ?? -Infinity;
  const reputationB = reputationByCarrier.get(b.carrierId) ?? -Infinity;
  if (reputationA !== reputationB) {
    return reputationB - reputationA;
  }
  const deliveredA = deliveredCountByCarrier.get(a.carrierId) ?? 0;
  const deliveredB = deliveredCountByCarrier.get(b.carrierId) ?? 0;
  if (deliveredA !== deliveredB) {
    return deliveredB - deliveredA;
  }
  if (a.createdAt.getTime() !== b.createdAt.getTime()) {
    return a.createdAt.getTime() - b.createdAt.getTime();
  }
  return a.id.localeCompare(b.id);
}

/**
 * MOVO-188 (AC2/AC3): ubica la oferta propia dentro de `rankedOffers` (ya resuelto el
 * desempate completo por el caller) y convierte el piso/techo a neto. `rankedOffers`
 * siempre incluye la oferta propia (viene de la misma query que la trajo como
 * `pending`) -- si no aparece, es una carrera entre la lectura de `listByCarrier` y
 * este batch (ej. se aceptó/retiró justo en el medio); se degrada a `null` en vez de
 * reportar una posición inventada.
 */
function buildCompetitiveRank(
  offerId: string,
  rankedOffers: CompetingOffer[],
  commissionRate: number
): OfferCompetitiveRank | null {
  const rank = rankedOffers.findIndex((offer) => offer.id === offerId) + 1;
  if (rank === 0) {
    return null;
  }
  const priceOffers = rankedOffers.map((offer) => offer.priceOffered);
  return {
    rank,
    total: rankedOffers.length,
    lowestPriceNetArs: computeNetFromGross(Math.min(...priceOffers), commissionRate),
    highestPriceNetArs: computeNetFromGross(Math.max(...priceOffers), commissionRate),
  };
}

function isRankableOffer(item: OfferWithShipmentContext): boolean {
  return item.status === OfferStatus.PENDING && item.shipment.status === ShipmentStatus.PUBLISHED;
}

export function createOffersService(
  offerRepository: OfferRepository,
  shipmentRepository: ShipmentRepository,
  notificationsClient?: NotificationsClient,
  logger?: OffersServiceLogger,
  /** MOVO-188: opcional -- sin inyectar (tests que no lo necesitan), el desempate
   * salta directo al criterio de envíos entregados/antigüedad, nunca rompe. */
  getCarrierReputationScores?: GetCarrierReputationScores
) {
  return {
    /**
     * MOVO-145 (AC1-AC5): ofertas propias del transportista autenticado.
     *
     * MOVO-188 (AC1/AC2/AC5): suma `competitiveRank` a cada ítem `pending` cuyo envío
     * sigue `published` -- una oferta puede seguir `pending` en base sobre un envío ya
     * cancelado (`cancelShipment` no toca las filas de `offers`, solo notifica, ver
     * shipments.service.ts) y ese caso no compite contra nadie. Resuelto en batch: una
     * sola query sobre los `shipmentId` distintos de la página, nunca una por ítem --
     * el desempate (reputación/envíos entregados) agrega como mucho dos queries MÁS
     * en total para toda la página (batch sobre los `carrierId` únicos que compiten),
     * nunca una por competidor.
     */
    async listMyOffers(
      carrierId: string,
      page: number,
      limit: number,
      status?: OfferStatus
    ): Promise<ListMyOffersResult> {
      // Mismo instante para las dos queries de abajo -- ver el comentario de
      // `mapOffer` en offer-repository.ts sobre la carrera de MOVO-188 que esto evita.
      const now = new Date();
      const { items, total } = await offerRepository.listByCarrier(carrierId, page, limit, status, now);

      const rankableShipmentIds = [...new Set(items.filter(isRankableOffer).map((item) => item.shipmentId))];
      const pendingByShipmentRaw =
        rankableShipmentIds.length > 0
          ? await offerRepository.listPendingOffersByShipmentIds(rankableShipmentIds, now)
          : new Map<string, CompetingOffer[]>();

      const competingCarrierIds = [
        ...new Set([...pendingByShipmentRaw.values()].flat().map((offer) => offer.carrierId)),
      ];
      const [reputationByCarrier, deliveredCountByCarrier] =
        competingCarrierIds.length > 0
          ? await Promise.all([
              getCarrierReputationScores
                ? getCarrierReputationScores(competingCarrierIds)
                : Promise.resolve(new Map<string, number | null>()),
              shipmentRepository.countDeliveredAsCarrierByIds(competingCarrierIds),
            ])
          : [new Map<string, number | null>(), new Map<string, number>()];

      const pendingByShipment = new Map(
        [...pendingByShipmentRaw.entries()].map(([shipmentId, offers]) => [
          shipmentId,
          [...offers].sort((a, b) => compareCompetingOffers(a, b, reputationByCarrier, deliveredCountByCarrier)),
        ])
      );

      const commissionRate = getCommissionConfig().movoCommissionRate;

      const itemsWithRank = items.map((item) => ({
        ...item,
        competitiveRank: isRankableOffer(item)
          ? buildCompetitiveRank(item.id, pendingByShipment.get(item.shipmentId) ?? [], commissionRate)
          : null,
      }));

      return { items: itemsWithRank, page, limit, total };
    },

    /**
     * AC6/AC7 de MOVO-144: delega en `offerRepository.acceptOffer()` (MOVO-102),
     * que ya resuelve todo el dominio (transacción atómica, bloqueo optimista,
     * demás ofertas pending -> superseded). Este método solo resuelve
     * autorización (solo el emisor del envío dueño de la oferta) y dispara las
     * notificaciones de AC9.
     */
    async acceptOffer(offerId: string, callerId: string): Promise<Offer> {
      const offer = await offerRepository.findById(offerId);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      const shipment = await shipmentRepository.findById(offer.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsSender(shipment, callerId);

      const { offer: accepted, shipmentId, superseded } = await offerRepository.acceptOffer(offerId, callerId);

      // AC9: best-effort, fire-and-forget -- la transacción de acceptOffer() ya
      // commiteó, un fallo de entrega no revierte la asignación.
      void dispatchOfferPush(notificationsClient, logger, {
        carrierId: accepted.carrierId,
        title: "Tu oferta fue aceptada",
        body: "El emisor eligió tu oferta para este envío.",
        shipmentId,
        offerId: accepted.id,
        type: "offer_accepted",
      });

      // `acceptOffer()` ya devuelve las ofertas superadas directo de la misma
      // transacción (hallazgo de review, PR #105) -- evita un `listByShipment`
      // completo aparte solo para reconstruir a quién notificar.
      void Promise.all(
        superseded.map((sibling) =>
          dispatchOfferPush(notificationsClient, logger, {
            carrierId: sibling.carrierId,
            title: "Tu oferta ya no está disponible",
            body: "El emisor eligió otra oferta para este envío.",
            shipmentId,
            offerId: sibling.id,
            type: "offer_superseded",
          })
        )
      );

      return accepted;
    },

    /**
     * AC8/AC9 de MOVO-144: rechazo puntual -- delega en `offerRepository.reject()`,
     * el envío sigue `published` (no lo toca este método) y el transportista puede
     * volver a ofertar (fila nueva). Solo notifica al rechazado.
     */
    async rejectOffer(offerId: string, callerId: string): Promise<Offer> {
      const offer = await offerRepository.findById(offerId);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      const shipment = await shipmentRepository.findById(offer.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsSender(shipment, callerId);

      const rejected = await offerRepository.reject(offerId);

      void dispatchOfferPush(notificationsClient, logger, {
        carrierId: rejected.carrierId,
        title: "Tu oferta fue rechazada",
        body: "El emisor rechazó tu oferta para este envío.",
        shipmentId: rejected.shipmentId,
        offerId: rejected.id,
        type: "offer_rejected",
      });

      return rejected;
    },

    /**
     * AC8 de MOVO-143: el transportista retira su propia oferta `pending`. Solo
     * resuelve autorización (dueño de la oferta) — `offerRepository.withdraw()` ya
     * hace el compare-and-swap y valida la transición vía `offer-state-machine.ts`
     * (409 `OFFER_INVALID_TRANSITION` sobre una ya resuelta/vencida, 409
     * `OFFER_CONCURRENT_MODIFICATION` sobre el caso concurrente, ambos ya mapeados en
     * `error-handler.ts` desde MOVO-144). Sin notificación push -- no la pide el AC.
     */
    async withdrawOffer(offerId: string, callerId: string): Promise<Offer> {
      const offer = await offerRepository.findById(offerId);
      if (!offer) {
        throw new ApiError(404, "OFFER_NOT_FOUND", "No existe una oferta con ese id.");
      }

      if (offer.carrierId !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el transportista dueño de la oferta puede retirarla.");
      }

      return offerRepository.withdraw(offerId);
    },
  };
}
