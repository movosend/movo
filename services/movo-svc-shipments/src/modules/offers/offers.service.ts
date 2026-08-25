import { ApiError, OfferStatus } from "@movo/shared";
import { FastifyBaseLogger } from "fastify";
import { OfferRepository } from "../../repositories/offer-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { NotificationsClient } from "../../adapters/notifications-client";
import { Offer, OfferWithShipmentContext } from "../../models/offer";
import { assertIsSender } from "../shipments/assert-shipment-access";

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

export function createOffersService(
  offerRepository: OfferRepository,
  shipmentRepository: ShipmentRepository,
  notificationsClient?: NotificationsClient,
  logger?: OffersServiceLogger
) {
  return {
    /** MOVO-145 (AC1-AC5): ofertas propias del transportista autenticado. */
    async listMyOffers(
      carrierId: string,
      page: number,
      limit: number,
      status?: OfferStatus
    ): Promise<ListMyOffersResult> {
      const { items, total } = await offerRepository.listByCarrier(carrierId, page, limit, status);
      return { items, page, limit, total };
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
  };
}
