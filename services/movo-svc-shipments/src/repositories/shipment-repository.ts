import { ShipmentStatus } from "@movo/shared";
import { PrismaClient, Shipment as ShipmentRow, ShipmentEvent as ShipmentEventRow, ShipmentPhoto as ShipmentPhotoRow } from "../generated/prisma/client";
import {
  INITIAL_SHIPMENT_STATUS,
  InsufficientCreationPhotosError,
  MIN_CREATION_PHOTOS_TO_PUBLISH,
  transition,
} from "../domain/shipment-state-machine";
import {
  Shipment,
  ShipmentEvent,
  ShipmentPhoto,
  CreateShipmentInput,
  PhotoStage,
  parseShipmentStatus,
} from "../models/shipment";

function mapShipment(row: ShipmentRow): Shipment {
  return {
    id: row.id,
    senderId: row.senderId,
    receiverId: row.receiverId,
    carrierId: row.carrierId,
    packageType: row.packageType,
    weightKg: row.weightKg.toNumber(),
    lengthCm: row.lengthCm.toNumber(),
    widthCm: row.widthCm.toNumber(),
    heightCm: row.heightCm.toNumber(),
    description: row.description,
    urgent: row.urgent,
    pickupAddress: row.pickupAddress,
    pickupLat: row.pickupLat.toNumber(),
    pickupLng: row.pickupLng.toNumber(),
    deliveryAddress: row.deliveryAddress,
    deliveryLat: row.deliveryLat.toNumber(),
    deliveryLng: row.deliveryLng.toNumber(),
    pickupDate: row.pickupDate,
    pickupTimeWindowStart: row.pickupTimeWindowStart,
    pickupTimeWindowEnd: row.pickupTimeWindowEnd,
    suggestedPriceArs: row.suggestedPriceArs ? row.suggestedPriceArs.toNumber() : null,
    calculationMethod: row.calculationMethod,
    agreedPriceArs: row.agreedPriceArs ? row.agreedPriceArs.toNumber() : null,
    paymentMethod: row.paymentMethod,
    status: parseShipmentStatus(row.status, "status"),
    lastStatusChangedAt: row.lastStatusChangedAt,
    deliveredAt: row.deliveredAt,
    receiverConfirmationDeadline: row.receiverConfirmationDeadline,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapEvent(row: ShipmentEventRow): ShipmentEvent {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    fromStatus: row.fromStatus ? parseShipmentStatus(row.fromStatus, "from_status") : null,
    toStatus: parseShipmentStatus(row.toStatus, "to_status"),
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function isUniquePhotoConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function mapPhoto(row: ShipmentPhotoRow): ShipmentPhoto {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    stage: row.stage,
    s3Key: row.s3Key,
    createdAt: row.createdAt,
  };
}

export interface ShipmentRepository {
  create(input: CreateShipmentInput): Promise<Shipment>;
  findById(id: string): Promise<Shipment | null>;
  /**
   * Única vía de escritura de `status` (AC2 de MOVO-104): valida la
   * transición con `shipment-state-machine.ts` (MOVO-105) antes de tocar la
   * fila, y dentro de la misma transacción registra el evento en
   * `shipment_events`. Ningún otro método de este repositorio toca `status`.
   * Compare-and-swap contra `status` (MOVO-118): lanza
   * `ShipmentConcurrentModificationError` si otra transición concurrente ya
   * ganó la carrera por el UPDATE.
   */
  updateStatus(id: string, to: ShipmentStatus, actorId: string | null, reason?: string): Promise<Shipment>;
  listEvents(shipmentId: string): Promise<ShipmentEvent[]>;
  addPhoto(shipmentId: string, stage: PhotoStage, s3Key: string): Promise<ShipmentPhoto>;
  listPhotos(shipmentId: string): Promise<ShipmentPhoto[]>;
  /**
   * MOVO-124: ¿este `s3Key` ya fue confirmado (tiene fila en `shipment_photos`)?
   * Fuente de verdad del sweep de fotos huérfanas -- el tracking de "pendiente" vive en
   * Redis (best-effort, puede perder la baja si `confirmPhoto` falla al hacer `ZREM`),
   * así que antes de borrar un objeto de S3 el sweep siempre revalida acá (AC3 de
   * MOVO-124: nunca confiar solo en que Redis diga "no confirmado").
   */
  existsPhotoByS3Key(s3Key: string): Promise<boolean>;
  /**
   * Envíos donde el usuario participa como sender o como receiver (AC9 de MOVO-80 —
   * todavía no hay rol de "carrier" asignado en este sprint). Paginado, más reciente
   * primero.
   */
  listByUser(userId: string, page: number, limit: number): Promise<{ items: Shipment[]; total: number }>;
  /**
   * MOVO-130 AC3: Envíos en awaiting_receiver_confirmation cuya deadline ya venció.
   * Lote acotado ordenado por deadline ascendente.
   */
  findExpiredAwaitingConfirmation(deadline: Date, limit: number): Promise<Shipment[]>;
  /**
   * MOVO-134: soporte del endpoint interno de baja de cuenta de `svc-users` -- ¿el
   * usuario (como sender, receiver o carrier) tiene algún envío en un estado no
   * terminal? Separa `disputed` del resto (`awaiting_receiver_confirmation`,
   * `published`, `assignment_pending`, `assigned`, `in_transit`) porque el mensaje de
   * error del lado de `svc-users` es distinto (una disputa no la resuelve el usuario
   * cancelando, necesita a un admin).
   */
  hasActiveShipmentsForUser(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }>;
  /**
   * MOVO-147 AC3/AC6: envíos completados (`delivered`) de un usuario como emisor y
   * como transportista -- lo que hoy `svc-users` devuelve hardcodeado en
   * `{ asSender: 0, asCarrier: 0 }` (`placeholderTransactionCounts()`). Dos `COUNT()`
   * independientes en vez de un `groupBy`: `senderId`/`carrierId` son columnas
   * distintas de la misma fila, no un único campo agrupable, así que un `groupBy` no
   * aplica acá -- lo que sí exige AC6 (resolverlo con un agregado, nunca trayendo los
   * envíos del usuario a memoria para contarlos en JS) se cumple igual con las dos
   * queries de `COUNT`.
   */
  countCompletedTransactions(userId: string): Promise<{ asSender: number; asCarrier: number }>;
}

export class ShipmentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`No existe un envío con id '${id}'`);
    this.name = "ShipmentNotFoundError";
  }
}

/**
 * MOVO-118: otra transición concurrente sobre el mismo envío ganó la carrera
 * por el UPDATE entre la lectura de `status` de este caller y su propio
 * write. Mismo patrón de compare-and-swap que `OfferConcurrentModificationError`
 * en `offer-repository.ts` (MOVO-102) — no hace falta `SELECT...FOR UPDATE`
 * ni `$queryRaw`, el `updateMany` condicionado por `status` ya usa el mismo
 * mecanismo de locking de Postgres (EvalPlanQual bajo READ COMMITTED).
 */
export class ShipmentConcurrentModificationError extends Error {
  constructor(public readonly id: string) {
    super(`El envío '${id}' fue modificado por otra transición concurrente`);
    this.name = "ShipmentConcurrentModificationError";
  }
}

export function createShipmentRepository(db: PrismaClient): ShipmentRepository {
  return {
    async create(input: CreateShipmentInput): Promise<Shipment> {
      const row = await db.$transaction(async (tx) => {
        const created = await tx.shipment.create({
          data: {
            senderId: input.senderId,
            receiverId: input.receiverId,
            packageType: input.packageType,
            weightKg: input.weightKg,
            lengthCm: input.lengthCm,
            widthCm: input.widthCm,
            heightCm: input.heightCm,
            description: input.description,
            urgent: input.urgent ?? false,
            pickupAddress: input.pickupAddress,
            pickupLat: input.pickupLat,
            pickupLng: input.pickupLng,
            deliveryAddress: input.deliveryAddress,
            deliveryLat: input.deliveryLat,
            deliveryLng: input.deliveryLng,
            pickupDate: input.pickupDate,
            pickupTimeWindowStart: input.pickupTimeWindowStart,
            pickupTimeWindowEnd: input.pickupTimeWindowEnd,
            suggestedPriceArs: input.suggestedPriceArs,
            calculationMethod: input.calculationMethod,
            receiverConfirmationDeadline: input.receiverConfirmationDeadline ?? null,
            status: INITIAL_SHIPMENT_STATUS,
            lastStatusChangedAt: new Date(),
          },
        });

        await tx.shipmentEvent.create({
          data: {
            shipmentId: created.id,
            fromStatus: null,
            toStatus: INITIAL_SHIPMENT_STATUS,
            actorId: input.senderId,
            reason: null,
          },
        });

        return created;
      });

      return mapShipment(row);
    },

    async findById(id: string): Promise<Shipment | null> {
      const row = await db.shipment.findUnique({ where: { id } });
      return row ? mapShipment(row) : null;
    },

    async updateStatus(id: string, to: ShipmentStatus, actorId: string | null, reason?: string): Promise<Shipment> {
      // Esta lectura ya NO es la fuente de verdad de la carrera (MOVO-118) —
      // solo sirve para validar la transición y la precondición de fotos
      // antes de pagar el costo de abrir una transacción. La corrección real
      // viene del `updateMany` condicionado por `status` de abajo.
      const current = await db.shipment.findUnique({ where: { id } });
      if (!current) {
        throw new ShipmentNotFoundError(id);
      }

      const from = parseShipmentStatus(current.status, "status");
      // Lanza InvalidShipmentTransitionError si la transición no es válida —
      // ningún UPDATE se ejecuta si esto tira.
      transition(from, to);

      // AC6 de MOVO-81: precondición de negocio sobre una transición que ya es
      // estructuralmente válida — publicar exige evidencia mínima del paquete. Vive acá
      // (la única vía de escritura de `status`, AC2 de MOVO-104) para que cualquier
      // caller futuro (MOVO-16, receptor confirma) quede cubierto sin tener que
      // reimplementar el chequeo.
      if (to === ShipmentStatus.PUBLISHED) {
        const creationPhotoCount = await db.shipmentPhoto.count({
          where: { shipmentId: id, stage: PhotoStage.creation },
        });
        if (creationPhotoCount < MIN_CREATION_PHOTOS_TO_PUBLISH) {
          throw new InsufficientCreationPhotosError(id, creationPhotoCount);
        }
      }

      const now = new Date();
      const deliveredAt = to === ShipmentStatus.DELIVERED ? now : current.deliveredAt;

      const row = await db.$transaction(async (tx) => {
        // MOVO-118: compare-and-swap, mismo patrón que
        // `offer-repository.ts#acceptOffer` (MOVO-102/AC9). El WHERE
        // condiciona por `status: from` (el valor leído más arriba) — bajo
        // READ COMMITTED, el UPDATE toma el lock de fila y, si otra
        // transición concurrente ya commiteó un cambio de status distinto,
        // EvalPlanQual hace que este WHERE deje de matchear y `count` da 0.
        const updated = await tx.shipment.updateMany({
          where: { id, status: from },
          data: {
            status: to,
            lastStatusChangedAt: now,
            deliveredAt,
          },
        });

        if (updated.count === 0) {
          throw new ShipmentConcurrentModificationError(id);
        }

        await tx.shipmentEvent.create({
          data: {
            shipmentId: id,
            fromStatus: from,
            toStatus: to,
            actorId,
            reason: reason ?? null,
          },
        });

        // `updateMany` no devuelve la fila actualizada (a diferencia de
        // `update`) — se reconstruye a mano en vez de pagar un SELECT extra,
        // mismo criterio que `accepted` en offer-repository.ts#acceptOffer.
        return { ...current, status: to, lastStatusChangedAt: now, deliveredAt, updatedAt: now };
      });

      return mapShipment(row);
    },

    async listEvents(shipmentId: string): Promise<ShipmentEvent[]> {
      const rows = await db.shipmentEvent.findMany({
        where: { shipmentId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapEvent);
    },

    async addPhoto(shipmentId: string, stage: PhotoStage, s3Key: string): Promise<ShipmentPhoto> {
      try {
        const row = await db.shipmentPhoto.create({
          data: { shipmentId, stage, s3Key },
        });
        return mapPhoto(row);
      } catch (error) {
        // Fix de review (PR #76, tmvergara): confirmar el mismo `s3Key` dos veces
        // (reintento del cliente) violaba antes solo la lógica de negocio -- ahora
        // choca con `shipment_photos_shipment_id_s3_key_key`. En vez de propagar el
        // conflicto, se trata como idempotente: devuelve la fila ya registrada, así el
        // conteo de AC6 nunca cuenta la misma foto dos veces.
        if (isUniquePhotoConflict(error)) {
          const existing = await db.shipmentPhoto.findFirst({ where: { shipmentId, s3Key } });
          if (existing) {
            return mapPhoto(existing);
          }
        }
        throw error;
      }
    },

    async listPhotos(shipmentId: string): Promise<ShipmentPhoto[]> {
      const rows = await db.shipmentPhoto.findMany({
        where: { shipmentId },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(mapPhoto);
    },

    async existsPhotoByS3Key(s3Key: string): Promise<boolean> {
      const row = await db.shipmentPhoto.findFirst({ where: { s3Key }, select: { id: true } });
      return row !== null;
    },

    async listByUser(userId: string, page: number, limit: number): Promise<{ items: Shipment[]; total: number }> {
      const where = { OR: [{ senderId: userId }, { receiverId: userId }] };
      const [rows, total] = await Promise.all([
        db.shipment.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.shipment.count({ where }),
      ]);
      return { items: rows.map(mapShipment), total };
    },

    async findExpiredAwaitingConfirmation(deadline: Date, limit: number): Promise<Shipment[]> {
      const rows = await db.shipment.findMany({
        where: {
          status: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
          receiverConfirmationDeadline: {
            lte: deadline,
          },
        },
        take: limit,
        orderBy: { receiverConfirmationDeadline: "asc" },
      });
      return rows.map(mapShipment);
    },

    async hasActiveShipmentsForUser(userId: string): Promise<{ hasActiveDispute: boolean; hasActiveShipments: boolean }> {
      const rows = await db.shipment.findMany({
        where: {
          OR: [{ senderId: userId }, { receiverId: userId }, { carrierId: userId }],
          status: {
            notIn: [ShipmentStatus.DELIVERED, ShipmentStatus.REJECTED_BY_RECEIVER, ShipmentStatus.CANCELLED],
          },
        },
        select: { status: true },
      });
      return {
        hasActiveDispute: rows.some((r) => r.status === ShipmentStatus.DISPUTED),
        hasActiveShipments: rows.some((r) => r.status !== ShipmentStatus.DISPUTED),
      };
    },

    async countCompletedTransactions(userId: string): Promise<{ asSender: number; asCarrier: number }> {
      const [asSender, asCarrier] = await Promise.all([
        db.shipment.count({ where: { senderId: userId, status: ShipmentStatus.DELIVERED } }),
        db.shipment.count({ where: { carrierId: userId, status: ShipmentStatus.DELIVERED } }),
      ]);
      return { asSender, asCarrier };
    },
  };
}
