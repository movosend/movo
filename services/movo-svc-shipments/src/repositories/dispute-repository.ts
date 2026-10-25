import { DisputeReason, DisputeStatus } from "@movo/shared";
import type { DisputePartyRole, DisputeStatementKind } from "@movo/shared";
import { PrismaClient } from "../generated/prisma/client";

/**
 * MOVO-334 (DD-054): datos de la disputa que `updateStatus` crea en la misma transacción que la
 * transición a `disputed` (`UpdateStatusOptions.dispute`). `openedBy: null` es una disputa de
 * sistema (barrido).
 */
export interface NewDispute {
  /** Lo genera el caller cuando necesita el id para responder; si falta lo genera la DB. */
  id?: string;
  openedBy: string | null;
  openedByRole: DisputePartyRole | null;
  reason: DisputeReason;
  description: string;
  photoKeys?: string[];
}

export interface DisputeRecord {
  id: string;
  shipmentId: string;
  openedBy: string | null;
  openedByRole: DisputePartyRole | null;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  openedAt: Date;
}

export interface DisputePhotoRecord {
  id: string;
  s3Key: string;
}

export interface DisputeStatementRecord {
  id: string;
  authorId: string;
  authorRole: DisputePartyRole;
  kind: DisputeStatementKind;
  text: string;
  createdAt: Date;
  photos: DisputePhotoRecord[];
}

export interface DisputeWithDetails extends DisputeRecord {
  /** Fotos de la apertura (sin descargo asociado). */
  photos: DisputePhotoRecord[];
  statements: DisputeStatementRecord[];
}

export interface AddDisputeStatementInput {
  disputeId: string;
  authorId: string;
  authorRole: DisputePartyRole;
  kind: DisputeStatementKind;
  text: string;
  photoKeys: string[];
}

/** Ya hay una disputa `open` sobre el envío (índice único parcial `disputes_shipment_open_key`). */
export class DisputeAlreadyOpenError extends Error {
  constructor(public readonly shipmentId: string) {
    super(`El envío '${shipmentId}' ya tiene una disputa abierta`);
    this.name = "DisputeAlreadyOpenError";
  }
}

/** La disputa ya no está `open` (la resolvió un admin, MOVO-34). */
export class DisputeNotOpenError extends Error {
  constructor(public readonly disputeId: string) {
    super(`La disputa '${disputeId}' no está abierta`);
    this.name = "DisputeNotOpenError";
  }
}

/** Segundo descargo de la misma parte, o segunda ampliación de quien abrió (único por disputa, autor y tipo). */
export class DisputeStatementAlreadySubmittedError extends Error {
  constructor(public readonly disputeId: string) {
    super(`Ya hay un descargo de esta parte en la disputa '${disputeId}'`);
    this.name = "DisputeStatementAlreadySubmittedError";
  }
}

/** Una de las fotos ya está asociada a una disputa (`dispute_photos.s3_key` es único). */
export class DisputePhotoAlreadyUsedError extends Error {
  constructor() {
    super("Una de las fotos ya está asociada a una disputa");
    this.name = "DisputePhotoAlreadyUsedError";
  }
}

export interface DisputeRepository {
  findOpenByShipment(shipmentId: string): Promise<DisputeRecord | null>;
  findById(id: string): Promise<DisputeWithDetails | null>;
  /** Lanza `DisputeNotOpenError`, `DisputeStatementAlreadySubmittedError` o `DisputePhotoAlreadyUsedError`. */
  addStatement(
    input: AddDisputeStatementInput,
  ): Promise<DisputeStatementRecord>;
  /** De las keys pedidas, las que ya están en alguna disputa. */
  findAssociatedPhotoKeys(keys: string[]): Promise<string[]>;
}

type DisputeRow = {
  id: string;
  shipmentId: string;
  openedBy: string | null;
  openedByRole: string | null;
  reason: string;
  description: string;
  status: string;
  openedAt: Date;
};

export function mapDisputeRow(row: DisputeRow): DisputeRecord {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    openedBy: row.openedBy,
    openedByRole: row.openedByRole as DisputePartyRole | null,
    reason: row.reason as DisputeReason,
    description: row.description,
    status: row.status as DisputeStatus,
    openedAt: row.openedAt,
  };
}

export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    (error as { code?: unknown }).code !== "P2002"
  ) {
    return false;
  }
  if (constraint === undefined) return true;
  // Prisma informa el índice violado en `meta.target` (nombre o columnas, según el driver).
  return JSON.stringify((error as { meta?: unknown }).meta ?? {}).includes(
    constraint,
  );
}

export function createDisputeRepository(db: PrismaClient): DisputeRepository {
  return {
    async findOpenByShipment(shipmentId) {
      const row = await db.dispute.findFirst({
        where: { shipmentId, status: DisputeStatus.OPEN },
      });
      return row ? mapDisputeRow(row) : null;
    },

    async findById(id) {
      const row = await db.dispute.findUnique({
        where: { id },
        include: {
          photos: {
            where: { statementId: null },
            orderBy: { createdAt: "asc" },
            select: { id: true, s3Key: true },
          },
          statements: {
            orderBy: { createdAt: "asc" },
            include: {
              photos: {
                orderBy: { createdAt: "asc" },
                select: { id: true, s3Key: true },
              },
            },
          },
        },
      });
      if (!row) return null;
      return {
        ...mapDisputeRow(row),
        photos: row.photos,
        statements: row.statements.map((statement) => ({
          id: statement.id,
          authorId: statement.authorId,
          authorRole: statement.authorRole as DisputePartyRole,
          kind: statement.kind as DisputeStatementKind,
          text: statement.text,
          createdAt: statement.createdAt,
          photos: statement.photos,
        })),
      };
    },

    async addStatement(input) {
      try {
        return await db.$transaction(async (tx) => {
          // `FOR UPDATE`: una resolución concurrente (MOVO-34) espera a que este descargo commitee,
          // o este ve la disputa ya cerrada.
          const locked = await tx.$queryRaw<Array<{ status: string }>>`
            SELECT "status"::text AS "status" FROM "shipments"."disputes" WHERE "id" = ${input.disputeId}::uuid FOR UPDATE`;
          if (locked[0]?.status !== DisputeStatus.OPEN) {
            throw new DisputeNotOpenError(input.disputeId);
          }
          const statement = await tx.disputeStatement.create({
            data: {
              disputeId: input.disputeId,
              authorId: input.authorId,
              authorRole: input.authorRole,
              kind: input.kind,
              text: input.text,
              photos: {
                create: input.photoKeys.map((s3Key) => ({
                  disputeId: input.disputeId,
                  s3Key,
                })),
              },
            },
            include: {
              photos: {
                orderBy: { createdAt: "asc" },
                select: { id: true, s3Key: true },
              },
            },
          });
          return {
            id: statement.id,
            authorId: statement.authorId,
            authorRole: statement.authorRole as DisputePartyRole,
            kind: statement.kind as DisputeStatementKind,
            text: statement.text,
            createdAt: statement.createdAt,
            photos: statement.photos,
          };
        });
      } catch (error) {
        if (isUniqueViolation(error, "s3_key"))
          throw new DisputePhotoAlreadyUsedError();
        if (isUniqueViolation(error))
          throw new DisputeStatementAlreadySubmittedError(input.disputeId);
        throw error;
      }
    },

    async findAssociatedPhotoKeys(keys) {
      if (keys.length === 0) return [];
      const rows = await db.disputePhoto.findMany({
        where: { s3Key: { in: keys } },
        select: { s3Key: true },
      });
      return rows.map((row) => row.s3Key);
    },
  };
}
