import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import {
  ApiError,
  InProgressShipment,
  notificationTriggerCategory,
  OpenActivitySummary,
  renderNotificationTrigger,
  ShipmentStatus,
  TripStatus,
  WithdrawOpenActivityResult,
} from "@movo/shared";
import { Prisma, PrismaClient } from "../../generated/prisma/client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { InvalidShipmentTransitionError } from "../../domain/shipment-state-machine";
import { InvalidOfferTransitionError } from "../../domain/offer-state-machine";
import { OfferConcurrentModificationError, OfferRepository } from "../../repositories/offer-repository";
import { ShipmentConcurrentModificationError } from "../../repositories/shipment-repository";
import { TripHasAcceptedPackagesError, TripNotDeclaredError, TripRepository } from "../../repositories/trip-repository";
import { shortShipmentId } from "./short-id";

/** Motivo que queda en la línea de tiempo de lo que se retira (MOVO-297 AC3). */
export const SANCTION_WITHDRAWAL_REASON = "cuenta suspendida";

/** Estados de un envío ya comprometido: la sanción no los toca, solo se listan y se avisa a la contraparte. */
const IN_PROGRESS_STATUSES = [
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED_UNFUNDED,
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
] as const;

/**
 * Envíos del sancionado que todavía no tienen transportista ni hold: se cancelan. Incluye los que aún
 * esperan al receptor (si confirma, pasarían a `published` a nombre de un suspendido) y los rechazados
 * (el emisor podría rediseñar el receptor y volver a publicar, DD-027).
 */
const WITHDRAWABLE_SHIPMENT_STATUSES = [
  ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
  ShipmentStatus.REJECTED_BY_RECEIVER,
  ShipmentStatus.PUBLISHED,
] as const;

/** El aviso a una contraparte no se repite en este plazo, así un reintento de `svc-admin` no la vuelve a notificar. */
const COUNTERPARTY_NOTICE_TTL_SECONDS = 7 * 24 * 60 * 60;

type Logger = Pick<FastifyBaseLogger, "info" | "warn">;

export interface SanctionEffectsDeps {
  db: PrismaClient;
  redis: Pick<Redis, "set" | "del">;
  offerRepository: OfferRepository;
  tripRepository: TripRepository;
  /**
   * Cancela un envío con el flujo existente (DD-032), en nombre de su emisor, solo si sigue en uno de
   * `onlyFrom`. Si cambió de estado entre el listado y la cancelación (un pago o una aceptación lo
   * comprometió) lanza `ShipmentConcurrentModificationError` en vez de cancelar con un hold sin liberar.
   */
  cancelShipment: (
    shipmentId: string,
    senderId: string,
    reason: string,
    onlyFrom: readonly ShipmentStatus[]
  ) => Promise<unknown>;
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

type Failure = WithdrawOpenActivityResult["failures"][number];

function roleOf(row: InProgressRow, userId: string): InProgressShipment["userRole"] {
  if (row.senderId === userId) return "sender";
  if (row.carrierId === userId) return "carrier";
  return "receiver";
}

/**
 * Perder una carrera con otro flujo (el emisor aceptó una oferta, el transportista retiró la suya, un
 * viaje recibió un paquete) no es un fallo: lo que cambió de estado ya no es "actividad abierta". Todo lo
 * demás (DB, payments, un bug) sí lo es y se informa en `failures` para que `svc-admin` reintente.
 */
function isLostRace(err: unknown): boolean {
  return (
    err instanceof ShipmentConcurrentModificationError ||
    err instanceof InvalidShipmentTransitionError ||
    err instanceof OfferConcurrentModificationError ||
    err instanceof InvalidOfferTransitionError ||
    err instanceof TripHasAcceptedPackagesError ||
    err instanceof TripNotDeclaredError ||
    (err instanceof ApiError && err.statusCode === 409)
  );
}

export function createSanctionEffectsService(deps: SanctionEffectsDeps) {
  const { db, redis, offerRepository, tripRepository, logger } = deps;

  // Los mismos filtros en la vista previa (MOVO-299) y en el retiro: si divergen, el panel promete una cosa y hace otra.
  const withdrawableShipmentsWhere = (userId: string): Prisma.ShipmentWhereInput => ({
    senderId: userId,
    status: { in: [...WITHDRAWABLE_SHIPMENT_STATUSES] },
  });
  // Las vencidas que siguen `pending` en la base ya no son ofertas vigentes: no se retiran.
  const pendingOffersWhere = (userId: string): Prisma.OfferWhereInput => ({
    carrierId: userId,
    status: "pending",
    OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
  });
  const declaredTripsWhere = (userId: string): Prisma.TripWhereInput => ({ carrierId: userId, status: TripStatus.DECLARED });

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

  /** Retira uno por uno: una carrera perdida se saltea, cualquier otro error se informa en `failures`. */
  async function retireEach(
    items: Array<{ id: string }>,
    kind: Failure["kind"],
    action: (id: string) => Promise<unknown>,
    failures: Failure[]
  ): Promise<string[]> {
    const done: string[] = [];
    for (const { id } of items) {
      try {
        await action(id);
        done.push(id);
      } catch (err) {
        if (isLostRace(err)) {
          logger?.info({ event: "sanction_withdrawal_lost_race", kind, id }, "Un elemento cambió de estado antes de retirarlo: se saltea");
        } else {
          logger?.warn({ err, event: "sanction_withdrawal_failed", kind, id }, "No se pudo retirar un elemento de la actividad abierta");
          failures.push({ kind, id });
        }
      }
    }
    return done;
  }

  async function notifyCounterparties(userId: string, sanctionId: string | undefined, shipments: InProgressRow[]): Promise<number> {
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
        // Con `sanctionId`, sancionar → levantar → volver a sancionar vuelve a avisar; sin él, la clave
        // solo distingue usuario y envío y un reintento dentro del TTL no duplica el aviso.
        const key = `sanction-notice:${userId}:${sanctionId ?? "-"}:${shipment.id}:${counterpartyId}`;
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
          logger?.warn(
            { err, event: "notification_dispatch_failed", shipmentId: shipment.id, userId: counterpartyId },
            "No se pudo avisar a la contraparte de un envío en curso del sancionado"
          );
          // Se libera la clave para que un reintento vuelva a avisar. Si Redis también falla, lo ya retirado
          // no se pierde con un 500: el aviso queda sin reintentar y se loguea.
          try {
            await redis.del(key);
          } catch (delErr) {
            logger?.warn({ err: delErr, event: "sanction_notice_key_release_failed", key }, "No se pudo liberar la clave del aviso");
          }
        }
      }
    }
    return notified;
  }

  async function listInProgressShipments(userId: string): Promise<InProgressShipment[]> {
    const rows = await listInProgress(userId);
    return rows.map((row) => ({
      id: row.id,
      shortId: shortShipmentId(row.id),
      status: row.status as InProgressShipment["status"],
      userRole: roleOf(row, userId),
      pickupAddress: row.pickupAddress,
      deliveryAddress: row.deliveryAddress,
    }));
  }

  return {
    /** MOVO-297 AC1: envíos en curso del usuario en cualquiera de sus tres roles. */
    listInProgressShipments,

    /** MOVO-299: lo que retiraría hoy `withdrawOpenActivity`, sin tocar nada. Solo lecturas. */
    async previewOpenActivity(userId: string): Promise<OpenActivitySummary> {
      const [shipments, offers, trips, recurringSeries, inProgressShipments] = await Promise.all([
        db.shipment.count({ where: withdrawableShipmentsWhere(userId) }),
        db.offer.count({ where: pendingOffersWhere(userId) }),
        db.trip.count({ where: declaredTripsWhere(userId) }),
        tripRepository.countActiveSeries(userId),
        listInProgressShipments(userId),
      ]);
      return { shipments, offers, trips, recurringSeries, inProgressShipments };
    },

    /**
     * MOVO-297 AC2-AC5. Idempotente: solo toma lo que sigue abierto (envíos aún sin comprometer, ofertas
     * `pending`, viajes `declared` sin paquetes aceptados), así que una segunda llamada no encuentra nada
     * que retirar ni repite avisos. Nada de lo asignado o en tránsito se toca. Lo que falla por algo que
     * no es una carrera perdida queda en `failures`: `svc-admin` no debe dar la sanción por aplicada.
     */
    async withdrawOpenActivity(userId: string, sanctionId?: string): Promise<WithdrawOpenActivityResult> {
      const failures: Failure[] = [];

      const withdrawable = await db.shipment.findMany({ where: withdrawableShipmentsWhere(userId), select: { id: true } });
      const cancelledShipmentIds = await retireEach(
        withdrawable,
        "shipment",
        (id) => deps.cancelShipment(id, userId, SANCTION_WITHDRAWAL_REASON, WITHDRAWABLE_SHIPMENT_STATUSES),
        failures
      );

      const pendingOffers = await db.offer.findMany({ where: pendingOffersWhere(userId), select: { id: true } });
      // Mismo estado que si el transportista la hubiera retirado (AC5): `withdrawn`.
      const withdrawnOfferIds = await retireEach(pendingOffers, "offer", (id) => offerRepository.withdraw(id), failures);

      // Primero se corta toda serie recurrente vigente, también la de un viaje ya `active`: si no, al
      // terminar se generaría la siguiente ocurrencia (y su push) a nombre de un usuario suspendido.
      let stoppedRecurrenceTripIds: string[] = [];
      try {
        stoppedRecurrenceTripIds = await tripRepository.stopRecurrenceForCarrier(userId);
      } catch (err) {
        logger?.warn({ err, event: "sanction_withdrawal_failed", kind: "series", id: userId }, "No se pudo cortar la recurrencia de los viajes");
        failures.push({ kind: "series", id: userId });
      }

      const declaredTrips = await db.trip.findMany({ where: declaredTripsWhere(userId), select: { id: true } });
      // Un viaje con paquetes aceptados lanza `TripHasAcceptedPackagesError`: queda, el envío sigue su curso.
      const cancelledTripIds = await retireEach(declaredTrips, "trip", (id) => tripRepository.cancel(id), failures);

      const notifiedCounterpartyCount = await notifyCounterparties(userId, sanctionId, await listInProgress(userId));

      return { cancelledShipmentIds, withdrawnOfferIds, cancelledTripIds, stoppedRecurrenceTripIds, notifiedCounterpartyCount, failures };
    },
  };
}

export type SanctionEffectsService = ReturnType<typeof createSanctionEffectsService>;
