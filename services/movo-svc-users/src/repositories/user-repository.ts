import { KycStatus } from "@movo/shared";
import {
  Prisma,
  UserRole as PrismaUserRole,
  KycStatus as PrismaKycStatus,
} from "../generated/prisma/client";
import { User, CreateUserInput, UserConflictError, parseUserRole, parseKycStatus, parseAccountStatus } from "../models/user";

export interface UserRepository {
  count(): Promise<number>;
  findByEmail(email: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  updateKycStatusIdentity(id: string, status: KycStatus): Promise<User | null>;
  updateKycStatusLicense(id: string, status: KycStatus): Promise<User | null>;
  updatePhotoUrl(id: string, photoUrl: string | null): Promise<User | null>;
  /**
   * Búsqueda de receptor (AC3 de MOVO-80) por nombre completo — no existe columna
   * `username` en este modelo. Excluye al propio caller.
   */
  search(query: string, excludeUserId: string, limit: number): Promise<User[]>;
}

type UserWithRoles = Prisma.UserGetPayload<{ include: { roles: true } }>;

/**
 * Traduce la fila de Prisma (ya en camelCase por los `@map` de schema.prisma) al
 * `User` de dominio. Campo por campo y no con spread, mismo criterio que
 * `toPublicUser` en `models/user.ts`: si mañana se agrega una columna, TypeScript
 * rompe acá y obliga a decidir explícitamente qué hacer con ella.
 */
function toDomainUser(row: UserWithRoles): User {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    passwordHash: row.passwordHash,
    dni: row.dni,
    phoneVerified: row.phoneVerified,
    photoUrl: row.photoUrl,
    kycStatusIdentity: parseKycStatus(row.kycStatusIdentity, "kyc_status_identity"),
    kycStatusLicense: parseKycStatus(row.kycStatusLicense, "kyc_status_license"),
    status: parseAccountStatus(row.status),
    bannedUntil: row.bannedUntil,
    birthdate: row.birthdate,
    roles: row.roles.map((r) => parseUserRole(r.role)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

/**
 * Con el driver adapter de Prisma 7 (@prisma/adapter-pg), un P2002 de Postgres no
 * expone los campos en conflicto en `error.meta.target` como en versiones/adapters
 * anteriores -- vienen anidados en
 * `error.meta.driverAdapterError.cause.constraint.fields`. Verificado empíricamente
 * contra Prisma 7.9.1 (ver historial de esta rama). Si una futura versión cambia
 * esta forma, esta función deja de matchear campos y el `create()` de más abajo
 * repropaga el P2002 original sin traducir a `UserConflictError` -- no hay riesgo
 * de falso positivo, en el peor caso se pierde la traducción a un error de dominio.
 */
function uniqueConstraintFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const driverError = error.meta?.["driverAdapterError"] as
    | { cause?: { constraint?: { fields?: unknown } } }
    | undefined;
  const fields = driverError?.cause?.constraint?.fields;
  return Array.isArray(fields) ? fields.filter((f): f is string => typeof f === "string") : [];
}

// `Prisma.TransactionClient` (no `PrismaClient`) a propósito: un `PrismaClient` normal
// lo satisface igual (superset estructural), pero esto permite además pasarle el
// cliente transaccional que entrega `db.$transaction(async (tx) => ...)` -- MOVO-72 lo
// necesita para que la escritura en `kyc_verification` y el update del caché en `users`
// (ambos vía repositorios separados) participen de la misma transacción.
export function createUserRepository(db: Prisma.TransactionClient): UserRepository {
  return {
    async count(): Promise<number> {
      return db.user.count();
    },

    async findByEmail(email: string): Promise<User | null> {
      const row = await db.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        include: { roles: true },
      });
      return row ? toDomainUser(row) : null;
    },

    async findByPhone(phone: string): Promise<User | null> {
      const row = await db.user.findUnique({ where: { phone }, include: { roles: true } });
      return row ? toDomainUser(row) : null;
    },

    async findById(id: string): Promise<User | null> {
      const row = await db.user.findUnique({ where: { id }, include: { roles: true } });
      return row ? toDomainUser(row) : null;
    },

    async create(input: CreateUserInput): Promise<User> {
      try {
        // Nested write: una sola operación atómica que inserta en users.users y
        // users.user_roles -- reemplaza el BEGIN/COMMIT manual de la versión con
        // `pg`. `include: { roles: true }` relee las filas ya persistidas (con
        // sus defaults/triggers aplicados), no arma la respuesta desde el input.
        const created = await db.user.create({
          data: {
            email: input.email,
            phone: input.phone,
            firstName: input.firstName,
            lastName: input.lastName,
            passwordHash: input.passwordHash,
            dni: input.dni ?? null,
            birthdate: input.birthdate ?? null,
            phoneVerified: input.phoneVerified,
            roles: {
              create: input.roles.map((role) => ({ role: role as unknown as PrismaUserRole })),
            },
            // MOVO-73: primera dirección del usuario, misma transacción atómica que el
            // alta de la cuenta y los roles (nested write de Prisma). `label`/`country`
            // no vienen del caller -- se hardcodean acá: la app es solo Argentina hoy
            // (mismo criterio que el regex de teléfono) y esta es siempre la dirección
            // por defecto porque es la única que existe en este punto.
            addresses: {
              create: {
                label: null,
                isDefault: true,
                street: input.address.street,
                streetNumber: input.address.number,
                floorApartment: input.address.floor ?? null,
                city: input.address.city,
                province: input.address.province,
                postalCode: input.address.zip,
                country: "AR",
                lat: input.address.lat,
                long: input.address.long,
              },
            },
          },
          include: { roles: true },
        });
        return toDomainUser(created);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const fields = uniqueConstraintFields(error);
          if (fields.includes("email")) {
            throw new UserConflictError("email");
          }
          if (fields.includes("phone")) {
            throw new UserConflictError("phone");
          }
        }
        throw error;
      }
    },

    async updateKycStatusIdentity(id: string, status: KycStatus): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: { kycStatusIdentity: status as unknown as PrismaKycStatus },
          include: { roles: true },
        });
        return toDomainUser(row);
      } catch (error) {
        if (isRecordNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async updateKycStatusLicense(id: string, status: KycStatus): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: { kycStatusLicense: status as unknown as PrismaKycStatus },
          include: { roles: true },
        });
        return toDomainUser(row);
      } catch (error) {
        if (isRecordNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async updatePhotoUrl(id: string, photoUrl: string | null): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: { photoUrl },
          include: { roles: true },
        });
        return toDomainUser(row);
      } catch (error) {
        if (isRecordNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },

    async search(query: string, excludeUserId: string, limit: number): Promise<User[]> {
      const words = query.split(/\s+/).filter(Boolean);
      const or: Prisma.UserWhereInput[] = [
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
      ];
      // "Nombre completo" (AC3 de MOVO-80): con 2+ palabras, además intenta matchear
      // "firstName lastName" y "lastName firstName" por separado -- cubre el caso real
      // de búsqueda ("Juan Pérez") sin una raw query concatenando columnas. Limitación
      // aceptada: nombres de 3+ tokens no se cubren perfecto -- mejora futura con
      // pg_trgm si el volumen de usuarios lo justifica.
      const [first, ...restWords] = words;
      if (first && restWords.length > 0) {
        const rest = restWords.join(" ");
        or.push({
          AND: [{ firstName: { contains: first, mode: "insensitive" } }, { lastName: { contains: rest, mode: "insensitive" } }],
        });
        or.push({
          AND: [{ lastName: { contains: first, mode: "insensitive" } }, { firstName: { contains: rest, mode: "insensitive" } }],
        });
      }

      const rows = await db.user.findMany({
        where: { AND: [{ id: { not: excludeUserId } }, { OR: or }] },
        include: { roles: true },
        take: limit,
        orderBy: { firstName: "asc" },
      });
      return rows.map(toDomainUser);
    },
  };
}
