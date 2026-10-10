import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { Hold, HoldFailureReason, HoldStatus } from "../generated/prisma/client";

export type { Hold };

export interface NewHoldAttempt {
  shipmentId: string;
  attempt: number;
  carrierId: string;
  collectorId: string;
  amountArs: number;
  applicationFeeArs: number;
  /** Hash del cuerpo del pedido (token, pagador, medio de pago): ver `requestFingerprint`. */
  requestFingerprint: string;
}

export interface HoldUpdate {
  status?: HoldStatus;
  statusDetail?: string | null;
  failureReason?: HoldFailureReason | null;
  mpPaymentId?: string | null;
  expiresAt?: Date | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Otro request ganó la carrera por el mismo intento (o por el hold vivo del envío). */
export class HoldAttemptConflictError extends Error {
  constructor() {
    super("Ya existe un intento de hold concurrente para el envío");
    this.name = "HoldAttemptConflictError";
  }
}

export interface HoldRepository {
  /** El intento más reciente del envío (mayor `attempt`), cualquiera sea su estado. */
  findLatestByShipment(shipmentId: string): Promise<Hold | null>;
  /**
   * Inserta un intento en `creating`. Tira `HoldAttemptConflictError` si otro request ya
   * lo creó (`shipment_id`+`attempt`) o si el envío ya tiene un hold vivo (índice parcial).
   */
  createAttempt(data: NewHoldAttempt): Promise<Hold>;
  update(id: string, patch: HoldUpdate): Promise<Hold>;
}

export function createHoldRepository(db: PrismaClient): HoldRepository {
  return {
    findLatestByShipment(shipmentId) {
      return db.hold.findFirst({ where: { shipmentId }, orderBy: { attempt: "desc" } });
    },

    async createAttempt(data) {
      try {
        return await db.hold.create({
          data: {
            shipmentId: data.shipmentId,
            attempt: data.attempt,
            carrierId: data.carrierId,
            collectorId: data.collectorId,
            amountArs: new Prisma.Decimal(data.amountArs),
            applicationFeeArs: new Prisma.Decimal(data.applicationFeeArs),
            requestFingerprint: data.requestFingerprint,
            status: "creating",
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new HoldAttemptConflictError();
        throw error;
      }
    },

    update(id, patch) {
      return db.hold.update({ where: { id }, data: patch });
    },
  };
}
