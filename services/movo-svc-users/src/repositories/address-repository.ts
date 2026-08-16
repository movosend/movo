import { PrismaClient, Prisma } from "../generated/prisma/client";
import {
  Address,
  CreateAddressInput,
  UpdateAddressInput,
} from "../models/address";

export interface AddressRepository {
  /** Default primero, luego `createdAt` desc (contrato de `GET /addresses`). */
  findAllByUserId(userId: string): Promise<Address[]>;
  findById(id: string): Promise<Address | null>;
  create(userId: string, input: CreateAddressInput): Promise<Address>;
  update(id: string, input: UpdateAddressInput): Promise<Address>;
  /** Si la fila borrada era la default y quedan otras, promueve la más reciente
   * (`createdAt` desc) a default -- nunca deja al usuario sin default teniendo
   * direcciones. */
  delete(id: string): Promise<void>;
}

type AddressRow = Prisma.AddressGetPayload<Record<string, never>>;

/** Mismo criterio que `toDomainUser`/`toDomainPushToken`: campo por campo, no
 * spread, para que agregar una columna rompa en compilación. */
function toDomainAddress(row: AddressRow): Address {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    isDefault: row.isDefault,
    street: row.street,
    streetNumber: row.streetNumber,
    floorApartment: row.floorApartment,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    country: row.country,
    lat: row.lat.toNumber(),
    long: row.long.toNumber(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createAddressRepository(db: PrismaClient): AddressRepository {
  return {
    async findAllByUserId(userId: string): Promise<Address[]> {
      const rows = await db.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
      return rows.map(toDomainAddress);
    },

    async findById(id: string): Promise<Address | null> {
      const row = await db.address.findUnique({ where: { id } });
      return row ? toDomainAddress(row) : null;
    },

    async create(userId: string, input: CreateAddressInput): Promise<Address> {
      const created = await db.$transaction(async (tx) => {
        // La primera dirección del usuario se fuerza default sin importar lo que
        // mande el cliente (contrato de MOVO-119) -- nunca dejar a un usuario con
        // direcciones guardadas y ninguna default.
        const existingCount = await tx.address.count({ where: { userId } });
        const isDefault =
          existingCount === 0 ? true : (input.isDefault ?? false);

        if (isDefault) {
          // Bajo READ COMMITTED, este UPDATE toma row-lock exclusivo sobre la fila
          // default actual (si existe) antes de que el INSERT de abajo compita con
          // otra transacción por el mismo índice único parcial -- mismo criterio que
          // `offer-repository.ts#acceptOffer` (MOVO-102), sin `SELECT ... FOR UPDATE`.
          await tx.address.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        }

        return tx.address.create({
          data: {
            userId,
            label: input.label ?? null,
            isDefault,
            street: input.street,
            streetNumber: input.streetNumber,
            floorApartment: input.floorApartment ?? null,
            city: input.city,
            province: input.province,
            postalCode: input.postalCode,
            country: input.country,
            lat: input.lat,
            long: input.long,
          },
        });
      });
      return toDomainAddress(created);
    },

    async update(id: string, input: UpdateAddressInput): Promise<Address> {
      const { isDefault, ...rest } = input;
      const updated = await db.$transaction(async (tx) => {
        if (isDefault) {
          const current = await tx.address.findUniqueOrThrow({ where: { id } });
          await tx.address.updateMany({
            where: { userId: current.userId, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.address.update({
          where: { id },
          data: { ...rest, ...(isDefault ? { isDefault: true } : {}) },
        });
      });
      return toDomainAddress(updated);
    },

    async delete(id: string): Promise<void> {
      await db.$transaction(async (tx) => {
        const deleted = await tx.address.delete({ where: { id } });
        if (!deleted.isDefault) {
          return;
        }
        const promoted = await tx.address.findFirst({
          where: { userId: deleted.userId },
          orderBy: { createdAt: "desc" },
        });
        if (promoted) {
          await tx.address.update({
            where: { id: promoted.id },
            data: { isDefault: true },
          });
        }
      });
    },
  };
}
