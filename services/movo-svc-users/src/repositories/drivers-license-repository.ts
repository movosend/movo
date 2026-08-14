import { Prisma, DriversLicenseStatus as PrismaDriversLicenseStatus } from "../generated/prisma/client";
import { DriversLicense, parseDriversLicenseStatus } from "../models/drivers-license";

export interface UpsertVerifiedDriversLicenseInput {
  userId: string;
  kycVerificationId: string;
  expirationDate: Date | null;
}

export interface DriversLicenseRepository {
  /** Único punto de escritura de esta tabla (kyc.service.ts#applyTerminalDecision, al
   * aprobarse una verificación de licencia) — upsert por `userId` (único en el
   * schema): no se acumula historial acá, cada re-verificación aprobada reemplaza el
   * registro anterior del carnet. */
  upsertVerified(input: UpsertVerifiedDriversLicenseInput): Promise<DriversLicense>;
}

type DriversLicenseRow = Prisma.DriversLicenseGetPayload<Record<string, never>>;

function toDomainDriversLicense(row: DriversLicenseRow): DriversLicense {
  return {
    id: row.id,
    userId: row.userId,
    kycVerificationId: row.kycVerificationId,
    expirationDate: row.expirationDate,
    status: parseDriversLicenseStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// `Prisma.TransactionClient`, no `PrismaClient` — mismo motivo que
// `kyc-verification-repository.ts`: el upsert participa de la misma `db.$transaction`
// que actualiza `users.kyc_status_license`.
export function createDriversLicenseRepository(db: Prisma.TransactionClient): DriversLicenseRepository {
  return {
    async upsertVerified(input: UpsertVerifiedDriversLicenseInput): Promise<DriversLicense> {
      const row = await db.driversLicense.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          kycVerificationId: input.kycVerificationId,
          expirationDate: input.expirationDate,
          status: "verified" as PrismaDriversLicenseStatus,
        },
        update: {
          kycVerificationId: input.kycVerificationId,
          expirationDate: input.expirationDate,
          status: "verified" as PrismaDriversLicenseStatus,
        },
      });
      return toDomainDriversLicense(row);
    },
  };
}
