import { FastifyBaseLogger } from "fastify";
import { StorageProvider } from "../adapters/storage-provider";
import { UserDeletionClient } from "../adapters/users-client";
import { RetentionRepository, ShipmentPurgeCandidate } from "../repositories/retention-repository";

const BATCH_SIZE = 100;

export interface HistoryPurgeResult {
  shipments: number;
  trips: number;
  /** Envíos vencidos que no se pudieron borrar en esta corrida (falla de S3); se reintentan. */
  failed: number;
}

/** Fecha de corte: `now` menos `years` años calendario. */
export function retentionCutoff(now: Date, years: number): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}

/**
 * MOVO-230 (Política de Privacidad §7): el historial de un envío vence cuando TODAS sus partes
 * (emisor, receptor y transportista, si hubo) están dadas de baja y la baja MÁS RECIENTE es
 * anterior a `cutoff`. Se cuenta desde la última y no desde la primera para que ninguna parte
 * pierda su antecedente (calificación, disputa) antes de sus propios 5 años desde la baja
 * ("Nota sobre el historial de envíos compartido"). Una parte sin fecha de baja (activa,
 * sancionada o desconocida) frena la purga.
 */
export function isHistoryExpired(
  shipment: Pick<ShipmentPurgeCandidate, "senderId" | "receiverId" | "carrierId">,
  deletionDates: ReadonlyMap<string, Date>,
  cutoff: Date,
): boolean {
  const parties = [shipment.senderId, shipment.receiverId, shipment.carrierId].filter(
    (id): id is string => id !== null,
  );
  return parties.every((id) => {
    const deletedAt = deletionDates.get(id);
    return deletedAt !== undefined && deletedAt.getTime() <= cutoff.getTime();
  });
}

export interface HistoryRetentionService {
  purgeExpiredHistory(now: Date, retentionYears: number): Promise<HistoryPurgeResult>;
}

/**
 * MOVO-230: purga física del historial vencido. Los candidatos salen de un prefiltro barato
 * en Postgres (cerrados hace más de `retentionYears`). Es válido porque la baja exige no tener
 * envíos activos ni disputas (`account-deletion.routes.ts`): el cierre es anterior a la baja de
 * cada parte. Si algún caso escapa a eso, el prefiltro solo atrasa la purga, nunca la adelanta.
 * Las fechas de baja salen de `svc-users`, que es la fuente de verdad (sin copia local).
 */
export function createHistoryRetentionService(
  repository: RetentionRepository,
  deletionClient: UserDeletionClient,
  storageProvider: StorageProvider,
  log: FastifyBaseLogger,
): HistoryRetentionService {
  async function purgeShipments(cutoff: Date): Promise<Pick<HistoryPurgeResult, "shipments" | "failed">> {
    let purged = 0;
    let failed = 0;
    let afterId: string | undefined;
    // Se recorre todo el prefiltro por páginas: los candidatos que no vencen (una parte sigue
    // activa) quedan en la tabla y no pueden tapar a los que siguen.
    for (;;) {
      const candidates = await repository.findShipmentCandidates(cutoff, BATCH_SIZE, afterId);
      if (candidates.length === 0) {
        break;
      }
      afterId = candidates[candidates.length - 1]?.id;

      const partyIds = candidates.flatMap((c) => [c.senderId, c.receiverId, ...(c.carrierId ? [c.carrierId] : [])]);
      const deletionDates = await deletionClient.findDeletionDates(partyIds);

      for (const shipment of candidates) {
        if (!isHistoryExpired(shipment, deletionDates, cutoff)) {
          continue;
        }
        try {
          // Primero S3 y después la fila, mismo criterio que `orphan-photo-sweep.ts`: si un
          // borrado falla, la fila sigue y la próxima corrida lo reintenta con las mismas keys.
          for (const key of shipment.photoKeys) {
            await storageProvider.deleteObject(key);
          }
          await repository.deleteShipment(shipment.id);
          purged += 1;
        } catch (err) {
          failed += 1;
          log.warn({ err, shipmentId: shipment.id }, "No se pudo purgar el historial vencido de un envío");
        }
      }

      if (candidates.length < BATCH_SIZE) {
        break;
      }
    }
    return { shipments: purged, failed };
  }

  async function purgeTrips(cutoff: Date): Promise<number> {
    let purged = 0;
    let afterId: string | undefined;
    for (;;) {
      const candidates = await repository.findTripCandidates(cutoff, BATCH_SIZE, afterId);
      if (candidates.length === 0) {
        break;
      }
      afterId = candidates[candidates.length - 1]?.id;

      const deletionDates = await deletionClient.findDeletionDates(candidates.map((trip) => trip.carrierId));
      const expired = candidates.filter((trip) => {
        const deletedAt = deletionDates.get(trip.carrierId);
        return deletedAt !== undefined && deletedAt.getTime() <= cutoff.getTime();
      });
      purged += await repository.deleteTrips(expired.map((trip) => trip.id));

      if (candidates.length < BATCH_SIZE) {
        break;
      }
    }
    return purged;
  }

  return {
    async purgeExpiredHistory(now, retentionYears) {
      const cutoff = retentionCutoff(now, retentionYears);
      const { shipments, failed } = await purgeShipments(cutoff);
      // Los viajes van después: así un envío purgado en esta corrida ya no tiene ofertas que
      // apunten al viaje.
      const trips = await purgeTrips(cutoff);
      return { shipments, trips, failed };
    },
  };
}
