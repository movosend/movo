import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { PrismaClient, Offer as OfferRow } from "../generated/prisma/client";
import { INITIAL_OFFER_STATUS, transition } from "../domain/offer-state-machine";
import {
  Offer,
  CreateOfferInput,
  parseOfferStatus,
  deriveEffectiveOfferStatus,
} from "../models/offer";

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function mapOffer(row: OfferRow): Offer {
  const rawStatus = parseOfferStatus(row.status);
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    carrierId: row.carrierId,
    priceOffered: row.priceOffered.toNumber(),
    offeredDate: row.offeredDate,
    message: row.message,
    carrierRatingAtOffer: row.carrierRatingAtOffer ? row.carrierRatingAtOffer.toNumber() : null,
    carrierNameAtOffer: row.carrierNameAtOffer,
    // AC11: expiración perezosa aplicada en TODA lectura, nunca el status crudo de la fila.
    status: deriveEffectiveOfferStatus(rawStatus, row.expiresAt),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
  };
}

export class OfferNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`No existe una oferta con id '${id}'`);
    this.name = "OfferNotFoundError";
  }
}

export class OfferShipmentNotFoundError extends Error {
  constructor(public readonly shipmentId: string) {
    super(`No existe un envío con id '${shipmentId}'`);
    this.name = "OfferShipmentNotFoundError";
  }
}

/**
 * AC10: `offered_date` tiene que caer dentro de la ventana de retiro del
 * envío. El AC habla de un rango `pickup_date_start`—`pickup_date_end`, pero
 * el `Shipment` real (MOVO-104) solo tiene una fecha de retiro (`pickupDate`)
 * más una ventana horaria sin fecha (`pickupTimeWindowStart/End`, @db.Time) —
 * ese rango de dos fechas nunca existió ni en el DER. Se interpreta acá como
 * el caso degenerado de un rango de un solo día: `offeredDate` debe coincidir
 * con `shipment.pickupDate`. El nombre del error se deja genérico
 * (`OutOfRange`, no `Mismatch`) por si en el futuro se reintroduce un rango
 * real de varios días.
 */
export class OfferDateOutOfRangeError extends Error {
  constructor(
    public readonly offeredDate: Date,
    public readonly shipmentId: string,
  ) {
    super(`offered_date fuera del rango de retiro permitido para el envío '${shipmentId}'`);
    this.name = "OfferDateOutOfRangeError";
  }
}

/**
 * AC7: el índice único parcial de la base
 * (`offers_shipment_carrier_pending_unique`) es la enforcement real — esto
 * solo traduce la violación (Postgres `23505`) a un error de dominio
 * legible, mismo patrón que `isUniqueConstraintError` en
 * `movo-svc-users/user-repository.ts`.
 */
export class DuplicateActiveOfferError extends Error {
  constructor(
    public readonly shipmentId: string,
    public readonly carrierId: string,
  ) {
    super(`El transportista '${carrierId}' ya tiene una oferta activa sobre el envío '${shipmentId}'`);
    this.name = "DuplicateActiveOfferError";
  }
}

/**
 * AC9: el envío ya no está en `published` en el momento del `UPDATE`
 * condicional de `acceptOffer` — otro emisor/proceso ya lo cerró (aceptó otra
 * oferta, lo canceló, etc.). No es un `OfferNotFoundError` ni un
 * `InvalidOfferTransitionError`: la oferta en sí podía seguir siendo
 * `pending` perfectamente válida, lo que cambió fue el envío.
 */
export class ShipmentNotAvailableForAssignmentError extends Error {
  constructor(public readonly shipmentId: string) {
    super(
      `El envío '${shipmentId}' ya no está disponible para asignar (otra oferta ya fue aceptada o el envío cambió de estado)`,
    );
    this.name = "ShipmentNotAvailableForAssignmentError";
  }
}

function isPendingOfferConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export interface OfferRepository {
  create(input: CreateOfferInput): Promise<Offer>;
  findById(id: string): Promise<Offer | null>;
  listByShipment(shipmentId: string): Promise<Offer[]>;
  /** AC6: el transportista retira su propia oferta antes de que el emisor responda. */
  withdraw(id: string): Promise<Offer>;
  /** AC6: el emisor rechaza explícitamente — el transportista puede volver a ofertar (fila nueva). */
  reject(id: string): Promise<Offer>;
  /**
   * AC8/AC9: única vía para aceptar una oferta. En una sola transacción
   * atómica — todo o nada —: la oferta pasa a `accepted`, las demás `pending`
   * del mismo envío pasan a `superseded`, y el envío pasa a
   * `assignment_pending` con bloqueo optimista (el `UPDATE` del envío
   * condiciona por `status = 'published'`; si no afecta ninguna fila, lanza
   * `ShipmentNotAvailableForAssignmentError` en vez de aplicar una segunda
   * asignación).
   */
  acceptOffer(id: string, actorId: string | null): Promise<{ offer: Offer; shipmentId: string }>;
}

export function createOfferRepository(db: PrismaClient): OfferRepository {
  return {
    async create(input: CreateOfferInput): Promise<Offer> {
      return db.$transaction(async (tx) => {
        const shipment = await tx.shipment.findUnique({ where: { id: input.shipmentId } });
        if (!shipment) {
          throw new OfferShipmentNotFoundError(input.shipmentId);
        }
        if (!sameDay(input.offeredDate, shipment.pickupDate)) {
          throw new OfferDateOutOfRangeError(input.offeredDate, input.shipmentId);
        }

        try {
          const created = await tx.offer.create({
            data: {
              shipmentId: input.shipmentId,
              carrierId: input.carrierId,
              priceOffered: input.priceOffered,
              offeredDate: input.offeredDate,
              message: input.message,
              expiresAt: input.expiresAt ?? null,
              carrierRatingAtOffer: input.carrierRatingAtOffer ?? null,
              carrierNameAtOffer: input.carrierNameAtOffer ?? null,
              status: INITIAL_OFFER_STATUS,
            },
          });
          return mapOffer(created);
        } catch (error) {
          if (isPendingOfferConflict(error)) {
            throw new DuplicateActiveOfferError(input.shipmentId, input.carrierId);
          }
          throw error;
        }
      });
    },

    async findById(id: string): Promise<Offer | null> {
      const row = await db.offer.findUnique({ where: { id } });
      return row ? mapOffer(row) : null;
    },

    async listByShipment(shipmentId: string): Promise<Offer[]> {
      const rows = await db.offer.findMany({ where: { shipmentId }, orderBy: { createdAt: "asc" } });
      return rows.map(mapOffer);
    },

    async withdraw(id: string): Promise<Offer> {
      return applyTerminalTransition(db, id, OfferStatus.WITHDRAWN, /* setRespondedAt */ false);
    },

    async reject(id: string): Promise<Offer> {
      return applyTerminalTransition(db, id, OfferStatus.REJECTED, /* setRespondedAt */ true);
    },

    async acceptOffer(id: string, actorId: string | null): Promise<{ offer: Offer; shipmentId: string }> {
      return db.$transaction(async (tx) => {
        const current = await tx.offer.findUnique({ where: { id } });
        if (!current) {
          throw new OfferNotFoundError(id);
        }

        // AC11 también rige acá: si la oferta ya venció (expiresAt pasado)
        // pero en base sigue 'pending', se evalúa como 'expired' — no se
        // puede aceptar algo vencido solo porque nadie corrió un UPDATE
        // físico todavía. `transition()` rechaza expired -> accepted.
        const from = deriveEffectiveOfferStatus(parseOfferStatus(current.status), current.expiresAt);
        transition(from, OfferStatus.ACCEPTED);

        // AC9: bloqueo optimista real. El UPDATE condiciona por
        // status='published' y se cuenta `count`. Bajo el nivel de
        // aislamiento por defecto de Postgres (READ COMMITTED), un UPDATE
        // toma un lock exclusivo de fila; una segunda transacción
        // concurrente que intente el mismo UPDATE sobre el mismo
        // shipment_id espera ese lock y, al hacer COMMIT la primera,
        // reevalúa su propio WHERE contra los datos ya commiteados
        // (EvalPlanQual) — si el status ya cambió, deja de matchear y
        // `count` da 0. No hace falta SELECT...FOR UPDATE ni $queryRaw: el
        // UPDATE condicional tipado (updateMany) ya expone `count` y usa el
        // mismo mecanismo de locking de Postgres.
        const shipmentUpdate = await tx.shipment.updateMany({
          where: { id: current.shipmentId, status: ShipmentStatus.PUBLISHED },
          data: {
            status: ShipmentStatus.ASSIGNMENT_PENDING,
            // Consecuencia directa de "quién ganó" — la columna ya existe
            // nullable exactamente para esto (MOVO-104, preparación para
            // las US de asignación de EP-03). No está en el AC8 literal,
            // documentado como superset explícito.
            carrierId: current.carrierId,
            lastStatusChangedAt: new Date(),
          },
        });
        if (shipmentUpdate.count === 0) {
          throw new ShipmentNotAvailableForAssignmentError(current.shipmentId);
        }

        await tx.shipmentEvent.create({
          data: {
            shipmentId: current.shipmentId,
            fromStatus: ShipmentStatus.PUBLISHED,
            toStatus: ShipmentStatus.ASSIGNMENT_PENDING,
            actorId,
            reason: `Oferta ${id} aceptada`,
          },
        });

        const now = new Date();
        const accepted = await tx.offer.update({
          where: { id },
          data: { status: OfferStatus.ACCEPTED, respondedAt: now },
        });

        // AC8, en lote: las demás ofertas pending del mismo envío pasan a
        // superseded. Excluye las que ya vencieron lógicamente (expiresAt
        // pasado) para que sigan reportando 'expired' en lectura, no
        // 'superseded' — una condición más en el WHERE, sin costo real.
        await tx.offer.updateMany({
          where: {
            shipmentId: current.shipmentId,
            status: OfferStatus.PENDING,
            id: { not: id },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: { status: OfferStatus.SUPERSEDED, respondedAt: now },
        });

        return { offer: mapOffer(accepted), shipmentId: current.shipmentId };
      });
    },
  };
}

/**
 * Helper compartido por `withdraw`/`reject`: mismo patrón que
 * `updateStatus()` de `shipment-repository.ts` (MOVO-104) — `findUnique`
 * fuera de la transacción de escritura.
 *
 * Limitación conocida (TOCTOU, mismo criterio aceptado que MOVO-118 en
 * `shipment-repository.ts#updateStatus`): sin lock atómico entre esta
 * lectura y el `UPDATE` de abajo, dos respuestas casi simultáneas sobre la
 * misma oferta podrían pisarse. No bloqueante para este ticket: a diferencia
 * de `acceptOffer` (AC9, resuelto con bloqueo optimista real porque el
 * propio ticket lo marca como "el punto crítico"), `withdraw`/`reject` no
 * tienen ningún AC que exija concurrencia segura.
 */
async function applyTerminalTransition(
  db: PrismaClient,
  id: string,
  to: OfferStatus.WITHDRAWN | OfferStatus.REJECTED,
  setRespondedAt: boolean,
): Promise<Offer> {
  const current = await db.offer.findUnique({ where: { id } });
  if (!current) {
    throw new OfferNotFoundError(id);
  }

  const from = deriveEffectiveOfferStatus(parseOfferStatus(current.status), current.expiresAt);
  transition(from, to);

  const row = await db.offer.update({
    where: { id },
    data: { status: to, respondedAt: setRespondedAt ? new Date() : current.respondedAt },
  });

  return mapOffer(row);
}
