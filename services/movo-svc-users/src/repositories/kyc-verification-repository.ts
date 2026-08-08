import { KycStatus } from "@movo/shared";
import {
  Prisma,
  KycStatus as PrismaKycStatus,
  VerificationType as PrismaVerificationType,
} from "../generated/prisma/client";
import { KycVerification, VerificationType, parseVerificationType } from "../models/kyc-verification";
import { parseKycStatus } from "../models/user";

export interface UpsertPendingSessionInput {
  userId: string;
  verificationType: VerificationType;
  provider: string;
  externalSessionId: string;
}

export interface ExpirePendingInput {
  userId: string;
  verificationType: VerificationType;
  /** Sesión a preservar del barrido. Didit hace dedupe implícito por `vendor_data`
   * (ver `didit-client.ts`): puede devolver la MISMA sesión que ya teníamos abierta, y
   * en ese caso expirar "todo lo pending del usuario" mataría el intento que estamos
   * por revivir. */
  exceptExternalSessionId?: string;
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
  /** Crea el intento, o revive uno ya existente con el mismo `externalSessionId`
   * dejándolo de nuevo en `pending`. Es un upsert y no un insert porque Didit puede
   * devolver una sesión que ya conocíamos (ver `ExpirePendingInput.exceptExternalSessionId`):
   * con un insert plano eso rompería contra la constraint única de la columna. */
  upsertPendingSession(input: UpsertPendingSessionInput): Promise<KycVerification>;
  /** Marca como `expired` los intentos `pending` del usuario — el intento anterior se
   * da por abandonado cuando se pide una sesión nueva (ver `kyc.service.ts#createSession`).
   * Devuelve cuántas filas se descartaron. */
  expirePendingByUserId(input: ExpirePendingInput): Promise<number>;
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
    async upsertPendingSession(input: UpsertPendingSessionInput): Promise<KycVerification> {
      const row = await db.kycVerification.upsert({
        where: { externalSessionId: input.externalSessionId },
        create: {
          userId: input.userId,
          verificationType: input.verificationType as PrismaVerificationType,
          provider: input.provider,
          externalSessionId: input.externalSessionId,
          status: KycStatus.PENDING as PrismaKycStatus,
        },
        // Revivir un intento ya conocido lo devuelve al estado de "recién pedido": se
        // limpian `resolvedAt`/`rawDecision` para no arrastrar la decisión de un ciclo
        // anterior, y `requestedAt` se refresca para que `findLatestByUserId` siga
        // devolviendo el intento realmente más reciente.
        update: {
          status: KycStatus.PENDING as PrismaKycStatus,
          requestedAt: new Date(),
          resolvedAt: null,
          rawDecision: Prisma.DbNull,
        },
      });
      return toDomainKycVerification(row);
    },

    async expirePendingByUserId(input: ExpirePendingInput): Promise<number> {
      const result = await db.kycVerification.updateMany({
        where: {
          userId: input.userId,
          verificationType: input.verificationType as PrismaVerificationType,
          status: KycStatus.PENDING as PrismaKycStatus,
          ...(input.exceptExternalSessionId
            ? { externalSessionId: { not: input.exceptExternalSessionId } }
            : {}),
        },
        data: { status: KycStatus.EXPIRED as PrismaKycStatus, resolvedAt: new Date() },
      });
      return result.count;
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
