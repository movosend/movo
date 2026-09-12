import { Prisma } from "../generated/prisma/client";

/**
 * Ficha de vehículo de un transportista (MOVO-172), `userId` único -- mismo patrón
 * que `DeviceKey`: sin multi-vehículo, un upsert reemplaza la fila anterior.
 */
export interface VehicleProfile {
  id: string;
  userId: string;
  brand: string;
  model: string;
  cargoCapacityLabel: string;
  licensePlate: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertVehicleProfileInput {
  brand: string;
  model: string;
  cargoCapacityLabel: string;
  licensePlate: string;
}

export interface VehicleProfileRepository {
  upsert(userId: string, input: UpsertVehicleProfileInput): Promise<VehicleProfile>;
  findByUserId(userId: string): Promise<VehicleProfile | null>;
}

function toDomainVehicleProfile(row: Prisma.VehicleProfileGetPayload<Record<string, never>>): VehicleProfile {
  return {
    id: row.id,
    userId: row.userId,
    brand: row.brand,
    model: row.model,
    cargoCapacityLabel: row.cargoCapacityLabel,
    licensePlate: row.licensePlate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createVehicleProfileRepository(db: Prisma.TransactionClient): VehicleProfileRepository {
  return {
    async upsert(userId: string, input: UpsertVehicleProfileInput): Promise<VehicleProfile> {
      const row = await db.vehicleProfile.upsert({
        where: { userId },
        create: { userId, ...input },
        update: input,
      });
      return toDomainVehicleProfile(row);
    },

    async findByUserId(userId: string): Promise<VehicleProfile | null> {
      const row = await db.vehicleProfile.findUnique({ where: { userId } });
      return row ? toDomainVehicleProfile(row) : null;
    },
  };
}
