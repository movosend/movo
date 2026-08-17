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
    suggestedPriceArs: row.suggestedPriceArs.toNumber(),
    agreedPriceArs: row.agreedPriceArs ? row.agreedPriceArs.toNumber() : null,
    paymentMethod: row.paymentMethod,
    status: parseShipmentStatus(row.status, "status"),
    lastStatusChangedAt: row.lastStatusChangedAt,
    deliveredAt: row.deliveredAt,
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
   */
  updateStatus(id: string, to: ShipmentStatus, actorId: string | null, reason?: string): Promise<Shipment>;
  listEvents(shipmentId: string): Promise<ShipmentEvent[]>;
  addPhoto(shipmentId: string, stage: PhotoStage, s3Key: string): Promise<ShipmentPhoto>;
  listPhotos(shipmentId: string): Promise<ShipmentPhoto[]>;
  /**
   * Envíos donde el usuario participa como sender o como receiver (AC9 de MOVO-80 —
   * todavía no hay rol de "carrier" asignado en este sprint). Paginado, más reciente
   * primero.
   */
  listByUser(userId: string, page: number, limit: number): Promise<{ items: Shipment[]; total: number }>;
}

export class ShipmentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`No existe un envío con id '${id}'`);
    this.name = "ShipmentNotFoundError";
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
      // Limitación conocida (TOCTOU, MOVO-118): este findUnique corre fuera
      // de la transacción del update de abajo, sin lock atómico — dos
      // transiciones casi simultáneas del mismo envío pueden leer el mismo
      // `status` viejo y la segunda pisa a la primera sin revalidar. Mismo
      // tipo de gap aceptado en MOVO-75/MOVO-115; no bloqueante para este
      // sprint (sin asignación automática ni alta concurrencia todavía).
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
      const row = await db.$transaction(async (tx) => {
        const updated = await tx.shipment.update({
          where: { id },
          data: {
            status: to,
            lastStatusChangedAt: now,
            deliveredAt: to === ShipmentStatus.DELIVERED ? now : current.deliveredAt,
          },
        });

        await tx.shipmentEvent.create({
          data: {
            shipmentId: id,
            fromStatus: from,
            toStatus: to,
            actorId,
            reason: reason ?? null,
          },
        });

        return updated;
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
  };
}
