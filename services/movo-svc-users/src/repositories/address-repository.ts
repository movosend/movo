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

/** Mismo criterio que `isUniqueConstraintError` de `user-repository.ts`. El único
 * índice único de `address` es `address_user_id_default_unique` (parcial, MOVO-119),
 * así que cualquier P2002 en `create()` solo puede venir de ahí -- no hace falta
 * inspeccionar `meta` para identificar el campo en conflicto. */
function isDefaultUniqueConflict(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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
      const attempt = (): Promise<AddressRow> =>
        db.$transaction(async (tx) => {
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
            // No cubre el caso "primera dirección concurrente" (no hay fila default que
            // lockear todavía) -- ese caso lo resuelve el catch de abajo con un retry.
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

      try {
        return toDomainAddress(await attempt());
      } catch (error) {
        if (!isDefaultUniqueConflict(error)) {
          throw error;
        }
        // Dos POST /addresses concurrentes con existingCount===0 en ambos: los dos
        // calculan isDefault=true y solo uno gana `address_user_id_default_unique`.
        // Para cuando este catch corre, la otra transacción ya hizo commit -- un
        // único retry vuelve a contar filas, ve existingCount>0 y ya no pisa el
        // índice único (mismo criterio de "retry post-commit" que la detección de
        // reuso de refresh token en MOVO-75, sin necesitar `SELECT ... FOR UPDATE`).
        return toDomainAddress(await attempt());
      }
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
