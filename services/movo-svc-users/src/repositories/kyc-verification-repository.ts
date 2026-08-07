import { KycStatus } from "@movo/shared";
import {
  Prisma,
  KycStatus as PrismaKycStatus,
  VerificationType as PrismaVerificationType,
} from "../generated/prisma/client";
import { KycVerification, VerificationType, parseVerificationType } from "../models/kyc-verification";
import { parseKycStatus } from "../models/user";

export interface CreateKycVerificationInput {
  userId: string;
  verificationType: VerificationType;
  provider: string;
  externalSessionId: string;
  status: KycStatus;
}

export interface ResolveKycVerificationInput {
  externalSessionId: string;
  /** Estado esperado ANTES de la transición — la condición que hace atómica la
   * idempotencia (AC7): si la fila ya no está en este estado (webhook duplicado, o ya
   * resuelta por un evento anterior), `resolveByExternalSessionId` no toca nada. */
  fromStatus: KycStatus;
  toStatus: KycStatus;
  rawDecision: unknown;
}

export interface KycVerificationRepository {
  create(input: CreateKycVerificationInput): Promise<KycVerification>;
  resolveByExternalSessionId(input: ResolveKycVerificationInput): Promise<KycVerification | null>;
  findByExternalSessionId(externalSessionId: string): Promise<KycVerification | null>;
  /** Último intento de un usuario para un tipo de verificación dado — usado por
   * `GET /kyc/status` para resolver el motivo cuando el estado es `manual_review`, sin
   * necesitar un join en cada polling (AC8). */
  findLatestByUserId(userId: string, verificationType: VerificationType): Promise<KycVerification | null>;
  /** AC10: casos en revisión manual, consultables a futuro por el panel de admin
   * (MOVO-32) — no se construye el panel acá, solo se deja el dato accesible. */
  findManualReviewCases(): Promise<KycVerification[]>;
}

type KycVerificationRow = Prisma.KycVerificationGetPayload<Record<string, never>>;

/** Mismo criterio que `toDomainUser` en `user-repository.ts`: campo por campo, no
 * spread, para que agregar una columna rompa en compilación y obligue a decidir qué
 * hacer con ella. */
function toDomainKycVerification(row: KycVerificationRow): KycVerification {
  return {
    id: row.id,
    userId: row.userId,
    verificationType: parseVerificationType(row.verificationType),
    provider: row.provider,
    externalSessionId: row.externalSessionId,
    status: parseKycStatus(row.status, "kyc_verification.status"),
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
    rawDecision: row.rawDecision,
  };
}

// `Prisma.TransactionClient`, no `PrismaClient` — ver comentario equivalente en
// `user-repository.ts` (MOVO-72 necesita que este repositorio participe de la misma
// `db.$transaction` que actualiza el caché de `users`).
export function createKycVerificationRepository(db: Prisma.TransactionClient): KycVerificationRepository {
  return {
    async create(input: CreateKycVerificationInput): Promise<KycVerification> {
      const row = await db.kycVerification.create({
        data: {
          userId: input.userId,
          verificationType: input.verificationType as PrismaVerificationType,
          provider: input.provider,
          externalSessionId: input.externalSessionId,
          status: input.status as PrismaKycStatus,
        },
      });
      return toDomainKycVerification(row);
    },

    async resolveByExternalSessionId(input: ResolveKycVerificationInput): Promise<KycVerification | null> {
      // `updateMany` con `status: fromStatus` en el `where` es la pieza atómica de la
      // idempotencia (AC7): Postgres solo aplica el UPDATE si la fila sigue en el
      // estado esperado. Dos entregas concurrentes del mismo webhook (o un reintento
      // de Didit sobre un evento ya procesado) hacen que como mucho una gane la
      // carrera — la otra ve `count === 0` y no hay una segunda escritura posible.
      const result = await db.kycVerification.updateMany({
        where: { externalSessionId: input.externalSessionId, status: input.fromStatus as PrismaKycStatus },
        data: {
          status: input.toStatus as PrismaKycStatus,
          resolvedAt: new Date(),
          rawDecision: input.rawDecision as Prisma.InputJsonValue,
        },
      });

      if (result.count === 0) {
        return null;
      }

      // `externalSessionId` es único (constraint de la migración) — releer por esa
      // columna trae la fila que se acaba de actualizar, con `userId` incluido (el
      // caller lo necesita para sincronizar el caché de `User`).
      const row = await db.kycVerification.findUnique({ where: { externalSessionId: input.externalSessionId } });
      return row ? toDomainKycVerification(row) : null;
    },

    async findByExternalSessionId(externalSessionId: string): Promise<KycVerification | null> {
      const row = await db.kycVerification.findUnique({ where: { externalSessionId } });
      return row ? toDomainKycVerification(row) : null;
    },

    async findLatestByUserId(userId: string, verificationType: VerificationType): Promise<KycVerification | null> {
      const row = await db.kycVerification.findFirst({
        where: { userId, verificationType: verificationType as PrismaVerificationType },
        orderBy: { requestedAt: "desc" },
      });
      return row ? toDomainKycVerification(row) : null;
    },

    async findManualReviewCases(): Promise<KycVerification[]> {
      const rows = await db.kycVerification.findMany({
        where: { status: KycStatus.MANUAL_REVIEW as PrismaKycStatus },
        orderBy: { requestedAt: "desc" },
      });
      return rows.map(toDomainKycVerification);
    },
  };
}
