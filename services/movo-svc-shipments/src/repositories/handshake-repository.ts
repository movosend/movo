import { ShipmentStatus } from "@movo/shared";
import { PrismaClient, HandshakeEvent as HandshakeEventRow } from "../generated/prisma/client";
import { transition } from "../domain/shipment-state-machine";
import { ShipmentConcurrentModificationError } from "./shipment-repository";
import { HandshakeEvent, HandshakeStage, parseHandshakeStage } from "../models/handshake";

function mapHandshakeEvent(row: HandshakeEventRow): HandshakeEvent {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    stage: parseHandshakeStage(row.stage),
    actorId: row.actorId,
    counterpartyId: row.counterpartyId,
    nonceHash: row.nonceHash,
    counterpartyLat: row.counterpartyLat.toNumber(),
    counterpartyLng: row.counterpartyLng.toNumber(),
    actorLat: row.actorLat.toNumber(),
    actorLng: row.actorLng.toNumber(),
    distanceM: row.distanceM.toNumber(),
    createdAt: row.createdAt,
  };
}

export interface ConfirmHandshakeInput {
  shipmentId: string;
  from: ShipmentStatus;
  to: ShipmentStatus;
  stage: HandshakeStage;
  /** Quien confirma -- el receptor de la custodia. */
  actorId: string;
  /** Quien generó el QR -- el cedente. */
  counterpartyId: string;
  nonceHash: string;
  counterpartyLat: number;
  counterpartyLng: number;
  actorLat: number;
  actorLng: number;
  distanceM: number;
  reason: string;
}

export interface HandshakeRepository {
  /**
   * AC3 de MOVO-158: única vía de escritura de un handshake confirmado -- en una sola
   * transacción atómica, todo o nada: (a) valida la transición contra el grafo
   * canónico (`shipment-state-machine.ts`, defensa en profundidad), (b) CAS sobre
   * `shipments.status` (mismo mecanismo que `shipment-repository.ts#updateStatus`,
   * lanza `ShipmentConcurrentModificationError` si otra transición concurrente ya
   * ganó la carrera), (c) inserta el evento en `shipment_events` (mantiene
   * `/shipments/:id/events` completo), (d) inserta el evento inmutable en
   * `handshake_events`. No reusa `shipment-repository.ts#updateStatus()` directo --
   * ese método abre su propia `$transaction`, no anidable acá (mismo motivo
   * documentado en `offer-repository.ts#acceptOffer`, MOVO-102/AC9).
   */
  confirmAndPersist(input: ConfirmHandshakeInput): Promise<HandshakeEvent>;
}

export function createHandshakeRepository(db: PrismaClient): HandshakeRepository {
  return {
    async confirmAndPersist(input: ConfirmHandshakeInput): Promise<HandshakeEvent> {
      return db.$transaction(async (tx) => {
        // Lanza InvalidShipmentTransitionError si el par (from, to) no es una arista
        // válida del grafo -- ningún UPDATE se ejecuta si esto tira.
        transition(input.from, input.to);

        const now = new Date();

        const updated = await tx.shipment.updateMany({
          where: { id: input.shipmentId, status: input.from },
          data: {
            status: input.to,
            lastStatusChangedAt: now,
            ...(input.to === ShipmentStatus.DELIVERED ? { deliveredAt: now } : {}),
          },
        });

        if (updated.count === 0) {
          throw new ShipmentConcurrentModificationError(input.shipmentId);
        }

        await tx.shipmentEvent.create({
          data: {
            shipmentId: input.shipmentId,
            fromStatus: input.from,
            toStatus: input.to,
            actorId: input.actorId,
            reason: input.reason,
          },
        });

        const eventRow = await tx.handshakeEvent.create({
          data: {
            shipmentId: input.shipmentId,
            stage: input.stage,
            actorId: input.actorId,
            counterpartyId: input.counterpartyId,
            nonceHash: input.nonceHash,
            counterpartyLat: input.counterpartyLat,
            counterpartyLng: input.counterpartyLng,
            actorLat: input.actorLat,
            actorLng: input.actorLng,
            distanceM: input.distanceM,
          },
        });

        return mapHandshakeEvent(eventRow);
      });
    },
  };
}
