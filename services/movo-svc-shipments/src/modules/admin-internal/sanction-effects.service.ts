import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import {
  InProgressShipment,
  notificationTriggerCategory,
  renderNotificationTrigger,
  ShipmentStatus,
  TripStatus,
  WithdrawOpenActivityResult,
} from "@movo/shared";
import { Prisma, PrismaClient } from "../../generated/prisma/client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { OfferRepository } from "../../repositories/offer-repository";
import { TripRepository } from "../../repositories/trip-repository";

/** Motivo que queda en la línea de tiempo de lo que se retira (MOVO-297 AC3). */
export const SANCTION_WITHDRAWAL_REASON = "cuenta suspendida";

/** Estados de un envío ya comprometido: la sanción no los toca, solo se listan y se avisa a la contraparte. */
const IN_PROGRESS_STATUSES = [
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
] as const;

/** El aviso a una contraparte no se repite en este plazo, así un reintento de `svc-admin` no la vuelve a notificar. */
const COUNTERPARTY_NOTICE_TTL_SECONDS = 7 * 24 * 60 * 60;

type Logger = Pick<FastifyBaseLogger, "info" | "warn">;

export interface SanctionEffectsDeps {
  db: PrismaClient;
  redis: Pick<Redis, "set" | "del">;
  offerRepository: OfferRepository;
  tripRepository: TripRepository;
  /** Cancela un envío con el flujo existente (ADR-032), en nombre de su emisor. */
  cancelShipment: (shipmentId: string, senderId: string, reason: string) => Promise<unknown>;
  notificationsClient?: NotificationsClient;
  logger?: Logger;
}

type InProgressRow = {
  id: string;
  status: string;
  senderId: string;
  carrierId: string | null;
  receiverId: string | null;
  pickupAddress: string;
  deliveryAddress: string;
};

function roleOf(row: InProgressRow, userId: string): InProgressShipment["userRole"] {
  if (row.senderId === userId) return "sender";
  if (row.carrierId === userId) return "carrier";
  return "receiver";
}

export function createSanctionEffectsService(deps: SanctionEffectsDeps) {
  const { db, redis, offerRepository, tripRepository, logger } = deps;

  async function listInProgress(userId: string): Promise<InProgressRow[]> {
    const where: Prisma.ShipmentWhereInput = {
      OR: [{ senderId: userId }, { carrierId: userId }, { receiverId: userId }],
      status: { in: [...IN_PROGRESS_STATUSES] },
    };
    return db.shipment.findMany({
      where,
      select: {
        id: true,
        status: true,
        senderId: true,
        carrierId: true,
        receiverId: true,
        pickupAddress: true,
        deliveryAddress: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Un fallo de uno (carrera con una aceptación, transición ya hecha) no frena al resto ni a un reintento. */
  async function retireEach(items: Array<{ id: string }>, kind: string, action: (id: string) => Promise<unknown>): Promise<string[]> {
    const done: string[] = [];
    for (const { id } of items) {
      try {
        await action(id);
        done.push(id);
      } catch (err) {
        logger?.warn({ err, event: "sanction_withdrawal_skipped", kind, id }, "No se pudo retirar un elemento de la actividad abierta");
      }
    }
    return done;
  }

  async function notifyCounterparties(userId: string, shipments: InProgressRow[]): Promise<number> {
    const client = deps.notificationsClient;
    if (!client) return 0;
    const { title, body } = renderNotificationTrigger("counterpartyCannotTakeNewShipments", undefined);
    const category = notificationTriggerCategory("counterpartyCannotTakeNewShipments");
    let notified = 0;
    for (const shipment of shipments) {
      const counterparties = new Set<string>();
      for (const id of [shipment.senderId, shipment.carrierId, shipment.receiverId]) {
        if (id && id !== userId) counterparties.add(id);
      }
      for (const counterpartyId of counterparties) {
        const key = `sanction-notice:${userId}:${shipment.id}:${counterpartyId}`;
        // NX: solo quien reserva la clave manda el push, un reintento no duplica el aviso.
        if ((await redis.set(key, "1", "EX", COUNTERPARTY_NOTICE_TTL_SECONDS, "NX")) !== "OK") continue;
        try {
          await client.sendPush({
            userId: counterpartyId,
            title,
            body,
            category,
            data: { type: "shipment", shipmentId: shipment.id },
          });
          notified += 1;
        } catch (err) {
          await redis.del(key);
          logger?.warn(
            { err, event: "notification_dispatch_failed", shipmentId: shipment.id, userId: counterpartyId },
            "No se pudo avisar a la contraparte de un envío en curso del sancionado"
          );
        }
      }
    }
    return notified;
  }

  return {
    /** MOVO-297 AC1: envíos en curso del usuario en cualquiera de sus tres roles. */
    async listInProgressShipments(userId: string): Promise<InProgressShipment[]> {
      const rows = await listInProgress(userId);
      return rows.map((row) => ({
        id: row.id,
        shortId: row.id.slice(0, 8).toUpperCase(),
        status: row.status as InProgressShipment["status"],
        userRole: roleOf(row, userId),
        pickupAddress: row.pickupAddress,
        deliveryAddress: row.deliveryAddress,
      }));
    },

    /**
     * MOVO-297 AC2-AC5. Idempotente: solo toma lo que sigue abierto (envíos `published`, ofertas
     * `pending`, viajes `declared` sin paquetes aceptados), así que una segunda llamada no encuentra
     * nada que retirar ni repite avisos. Nada de lo asignado o en tránsito se toca.
     */
    async withdrawOpenActivity(userId: string): Promise<WithdrawOpenActivityResult> {
      const published = await db.shipment.findMany({
        where: { senderId: userId, status: ShipmentStatus.PUBLISHED },
        select: { id: true },
      });
      const cancelledShipmentIds = await retireEach(published, "shipment", (id) =>
        deps.cancelShipment(id, userId, SANCTION_WITHDRAWAL_REASON)
      );

      // Las vencidas que siguen `pending` en la base ya no son ofertas vigentes: no se retiran.
      const pendingOffers = await db.offer.findMany({
        where: { carrierId: userId, status: "pending", OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
        select: { id: true },
      });
      // Mismo estado que si el transportista la hubiera retirado (AC5): `withdrawn`.
      const withdrawnOfferIds = await retireEach(pendingOffers, "offer", (id) => offerRepository.withdraw(id));

      const declaredTrips = await db.trip.findMany({
        where: { carrierId: userId, status: TripStatus.DECLARED },
        select: { id: true },
      });
      // Un viaje con paquetes aceptados lanza `TripHasAcceptedPackagesError`: queda, el envío sigue su curso.
      // `stopRecurrence` evita que una serie recurrente siga generando ocurrencias de un usuario suspendido.
      const cancelledTripIds = await retireEach(declaredTrips, "trip", (id) => tripRepository.cancel(id, { stopRecurrence: true }));

      const notifiedCounterpartyCount = await notifyCounterparties(userId, await listInProgress(userId));

      return { cancelledShipmentIds, withdrawnOfferIds, cancelledTripIds, notifiedCounterpartyCount };
    },
  };
}

export type SanctionEffectsService = ReturnType<typeof createSanctionEffectsService>;
