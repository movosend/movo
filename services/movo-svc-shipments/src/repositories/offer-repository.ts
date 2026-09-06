import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { Prisma, PrismaClient, Offer as OfferRow, Shipment as ShipmentRow } from "../generated/prisma/client";
import { INITIAL_OFFER_STATUS, transition } from "../domain/offer-state-machine";
import { transition as transitionShipmentStatus } from "../domain/shipment-state-machine";
import {
  Offer,
  CreateOfferInput,
  parseOfferStatus,
  deriveEffectiveOfferStatus,
  OfferWithShipmentContext,
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
    tripId: row.tripId,
    estimatedDeliveryDate: row.estimatedDeliveryDate,
    estimatedDeliveryTimeWindowStart: row.estimatedDeliveryTimeWindowStart,
    estimatedDeliveryTimeWindowEnd: row.estimatedDeliveryTimeWindowEnd,
  };
}

function mapOfferWithShipment(row: OfferRow & { shipment: ShipmentRow }): OfferWithShipmentContext {
  return {
    ...mapOffer(row),
    shipment: {
      id: row.shipment.id,
      status: row.shipment.status as ShipmentStatus,
      pickupAddress: row.shipment.pickupAddress,
      pickupDate: row.shipment.pickupDate,
      deliveryAddress: row.shipment.deliveryAddress,
    },
  };
}

/**
 * MOVO-145 (AC2/AC3): traduce un filtro de estado EFECTIVO a un WHERE de Postgres —
 * necesario porque el conteo de paginación tiene que salir de la base, no de un
 * post-filtro en memoria sobre `deriveEffectiveOfferStatus`. `expired` no es un valor
 * de columna real (AC11): mapea a `pending` con `expiresAt` vencido. `pending` en sí
 * excluye lo que ya venció, para no contarlo dos veces bajo estados distintos.
 */
function offerStatusWhere(status: OfferStatus | undefined, now: Date): Prisma.OfferWhereInput {
  if (status === undefined) {
    return {};
  }
  if (status === OfferStatus.EXPIRED) {
    return { status: OfferStatus.PENDING, expiresAt: { lt: now } };
  }
  if (status === OfferStatus.PENDING) {
    return { status: OfferStatus.PENDING, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] };
  }
  return { status };
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

/**
 * Compare-and-swap perdido: otra transacción (típicamente `acceptOffer`,
 * que puede marcar esta misma oferta como `superseded` en su batch) ya
 * escribió sobre esta fila entre la lectura y el `UPDATE` de esta
 * operación. Hallazgo de review (PR #70, tmvergara) sobre
 * `applyTerminalTransition`: sin este chequeo, un `withdraw`/`reject`
 * concurrente con un `acceptOffer` del mismo envío podía pisar un
 * `superseded` ya resuelto y dejar el historial de la oferta incorrecto.
 */
export class OfferConcurrentModificationError extends Error {
  constructor(public readonly id: string) {
    super(`La oferta '${id}' fue modificada por otra operación antes de poder aplicar este cambio`);
    this.name = "OfferConcurrentModificationError";
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
  /**
   * AC6: el transportista retira su propia oferta antes de que el emisor
   * responda. El `UPDATE` es compare-and-swap contra el `status` leído —
   * lanza `OfferConcurrentModificationError` si otra operación (típicamente
   * `acceptOffer` marcándola `superseded`) ya escribió sobre la fila.
   */
  withdraw(id: string): Promise<Offer>;
  /**
   * AC6: el emisor rechaza explícitamente — el transportista puede volver a
   * ofertar (fila nueva). Mismo compare-and-swap que `withdraw`.
   */
  reject(id: string): Promise<Offer>;
  /**
   * AC8/AC9: única vía para aceptar una oferta. En una sola transacción
   * atómica — todo o nada —: la oferta pasa a `accepted`, las demás `pending`
   * del mismo envío pasan a `superseded`, y el envío pasa a
   * `assignment_pending` con bloqueo optimista (el `UPDATE` del envío
   * condiciona por `status = 'published'`; si no afecta ninguna fila, lanza
   * `ShipmentNotAvailableForAssignmentError` en vez de aplicar una segunda
   * asignación). El `UPDATE` de la oferta en sí también es compare-and-swap
   * (lanza `OfferConcurrentModificationError` si un `withdraw`/`reject`
   * concurrente ya la modificó).
   */
  acceptOffer(
    id: string,
    actorId: string | null,
  ): Promise<{
    offer: Offer;
    shipmentId: string;
    superseded: Array<{ id: string; carrierId: string }>;
  }>;
  /**
   * MOVO-145 (AC1-AC4): ofertas propias del transportista, más recientes primero, con
   * el contexto mínimo del envío resuelto en la misma query (`include`, nunca N+1).
   * `status` filtra por el valor EFECTIVO (`offerStatusWhere`) — sin filtro, todas.
   */
  listByCarrier(
    carrierId: string,
    page: number,
    limit: number,
    status?: OfferStatus
  ): Promise<{ items: OfferWithShipmentContext[]; total: number }>;
  /**
   * MOVO-142 (AC5): shipmentIds del set dado donde `carrierId` tiene una oferta con
   * status EFECTIVO `pending` (reusa `offerStatusWhere` -- no cuenta
   * withdrawn/rejected/expired). Batch para el `hasMyOffer` de
   * `GET /shipments/available`, sin N+1 sobre la página de resultados.
   */
  listPendingOfferedShipmentIds(carrierId: string, shipmentIds: string[]): Promise<Set<string>>;
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
              tripId: input.tripId ?? null,
              estimatedDeliveryDate: input.estimatedDeliveryDate ?? null,
              estimatedDeliveryTimeWindowStart: input.estimatedDeliveryTimeWindowStart ?? null,
              estimatedDeliveryTimeWindowEnd: input.estimatedDeliveryTimeWindowEnd ?? null,
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

    async acceptOffer(
      id: string,
      actorId: string | null,
    ): Promise<{
      offer: Offer;
      shipmentId: string;
      superseded: Array<{ id: string; carrierId: string }>;
    }> {
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

        // Hallazgo de review (PR #70, tmvergara): este UPDATE escribe
        // shipment.status directo, por fuera de shipment-repository.ts —
        // el único otro lugar del servicio que toca esa columna, y el que
        // CLAUDE.md/MOVO-104 documentan como "la única vía de escritura".
        // No se enruta a través de ese repositorio porque updateStatus()
        // abre su propia `$transaction` (MOVO-118 le sumó compare-and-swap,
        // pero sigue siendo una transacción propia) — no se puede anidar
        // dentro de la transacción única que necesita este método para que
        // shipment+offer+evento sean atómicos entre sí. En cambio, se valida
        // acá la transición contra el mismo grafo canónico
        // (shipment-state-machine.ts) antes de ejecutar el UPDATE: si el
        // grafo cambia (se agrega una guarda, se restringe esta arista),
        // esto lanza InvalidShipmentTransitionError en vez de seguir
        // escribiendo una transición no auditada contra el mecanismo
        // canónico.
        transitionShipmentStatus(ShipmentStatus.PUBLISHED, ShipmentStatus.ASSIGNMENT_PENDING);

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
            // MOVO-180: mismo criterio que carrierId -- el receptor necesita ver la
            // entrega estimada en el detalle del envío, no solo en el histórico de la
            // oferta. Quedan null si la oferta ganadora nunca los declaró (opcionales).
            estimatedDeliveryDate: current.estimatedDeliveryDate,
            estimatedDeliveryTimeWindowStart: current.estimatedDeliveryTimeWindowStart,
            estimatedDeliveryTimeWindowEnd: current.estimatedDeliveryTimeWindowEnd,
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
        // Mismo compare-and-swap que applyTerminalTransition (PR #70,
        // tmvergara): protege el caso simétrico — un withdraw/reject
        // concurrente sobre esta misma oferta, entre el findUnique de
        // arriba y este UPDATE, no debería pisarse silenciosamente con
        // "accepted" solo porque esta transacción ya reservó el envío.
        const offerUpdate = await tx.offer.updateMany({
          where: { id, status: current.status },
          data: { status: OfferStatus.ACCEPTED, respondedAt: now },
        });
        if (offerUpdate.count === 0) {
          throw new OfferConcurrentModificationError(id);
        }
        const accepted = { ...current, status: OfferStatus.ACCEPTED, respondedAt: now };

        // AC8, en lote: las demás ofertas pending del mismo envío pasan a
        // superseded. Excluye las que ya vencieron lógicamente (expiresAt
        // pasado) para que sigan reportando 'expired' en lectura, no
        // 'superseded' — una condición más en el WHERE, sin costo real.
        const supersededWhere = {
          shipmentId: current.shipmentId,
          status: OfferStatus.PENDING,
          id: { not: id },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        };
        // `carrierId` se lee ANTES del `updateMany` (que no devuelve filas) --
        // hallazgo de review (PR #105): evita que el caller (offers.service.ts,
        // AC9) tenga que hacer un `listByShipment` completo aparte solo para
        // saber a quién notificar.
        const superseded = await tx.offer.findMany({
          where: supersededWhere,
          select: { id: true, carrierId: true },
        });
        await tx.offer.updateMany({
          where: supersededWhere,
          data: { status: OfferStatus.SUPERSEDED, respondedAt: now },
        });

        return { offer: mapOffer(accepted), shipmentId: current.shipmentId, superseded };
      });
    },

    async listByCarrier(
      carrierId: string,
      page: number,
      limit: number,
      status?: OfferStatus
    ): Promise<{ items: OfferWithShipmentContext[]; total: number }> {
      const where: Prisma.OfferWhereInput = { carrierId, ...offerStatusWhere(status, new Date()) };
      const [rows, total] = await Promise.all([
        db.offer.findMany({
          where,
          include: { shipment: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.offer.count({ where }),
      ]);
      return { items: rows.map(mapOfferWithShipment), total };
    },

    async listPendingOfferedShipmentIds(carrierId: string, shipmentIds: string[]): Promise<Set<string>> {
      if (shipmentIds.length === 0) {
        return new Set();
      }
      const rows = await db.offer.findMany({
        where: { carrierId, shipmentId: { in: shipmentIds }, ...offerStatusWhere(OfferStatus.PENDING, new Date()) },
        select: { shipmentId: true },
      });
      return new Set(rows.map((r) => r.shipmentId));
    },
  };
}

/**
 * Helper compartido por `withdraw`/`reject`: `findUnique` fuera de la
 * transacción de escritura, mismo patrón inicial que `updateStatus()` de
 * `shipment-repository.ts` (MOVO-104).
 *
 * A diferencia de ese helper, el `UPDATE` de acá SÍ es un compare-and-swap
 * (`updateMany` condicionado por `status: current.status`, no un `update`
 * incondicional) — hallazgo de review (PR #70, tmvergara): sin esto, un
 * `withdraw`/`reject` que lee la oferta como `pending` podía pisar con
 * `withdrawn`/`rejected` un `superseded` que `acceptOffer()` ya había
 * escrito para esa misma fila mientras tanto (el emisor aceptó otra oferta
 * del mismo envío, entre la lectura y este `UPDATE`), dejando el historial
 * de la oferta incorrecto. Si `count === 0`, alguien más ya escribió sobre
 * esta fila entre la lectura y este punto — se lanza
 * `OfferConcurrentModificationError` en vez de pisarlo.
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

  const respondedAt = setRespondedAt ? new Date() : current.respondedAt;
  const result = await db.offer.updateMany({
    where: { id, status: current.status },
    data: { status: to, respondedAt },
  });
  if (result.count === 0) {
    throw new OfferConcurrentModificationError(id);
  }

  return mapOffer({ ...current, status: to, respondedAt });
}
