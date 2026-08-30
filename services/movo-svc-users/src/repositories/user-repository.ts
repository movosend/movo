import { KycStatus } from "@movo/shared";
import {
  Prisma,
  UserRole as PrismaUserRole,
  KycStatus as PrismaKycStatus,
  AccountStatus as PrismaAccountStatus,
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
  /**
   * MOVO-115: swap atómico de `photo_url` -- lee el valor vigente y lo compara-y-
   * reemplaza en la misma operación (compare-and-swap con reintento si otro
   * `swapPhotoUrl` concurrente ganó la carrera entre medio), así el `previousPhotoUrl`
   * devuelto es siempre el valor que este swap realmente pisó, nunca uno leído por
   * fuera de la función. Reemplaza al viejo `updatePhotoUrl` (find-then-update en dos
   * pasos separados en el caller, sin garantía de que el valor leído siguiera vigente
   * al escribir -- ver el ticket) -- `confirmPhoto()`/`deletePhoto()` son sus únicos
   * dos callers. Devuelve `null` si el usuario no existe.
   */
  swapPhotoUrl(id: string, photoUrl: string | null): Promise<{ user: User; previousPhotoUrl: string | null } | null>;
  /**
   * MOVO-124: ¿esta `photoUrl` sigue vigente en `users.photo_url`? Fuente de verdad
   * del sweep de fotos huérfanas -- el tracking de "pendiente" vive en Redis (best-
   * effort, puede perder la baja si `confirmPhoto` falla al hacer `ZREM`), así que
   * antes de borrar un objeto de S3 el sweep siempre revalida acá (AC3 de MOVO-124:
   * nunca confiar solo en que Redis diga "no confirmado").
   */
  existsByPhotoUrl(photoUrl: string): Promise<boolean>;
  /**
   * MOVO-133 AC1: actualización parcial de nombre/apellido -- ambos campos opcionales.
   * El caller (`users.service.ts#updateProfile`) nunca llama con los dos `undefined`
   * (el schema de `PATCH /users/me` exige `minProperties:1`).
   */
  updateProfile(id: string, input: { firstName?: string; lastName?: string }): Promise<User | null>;
  /**
   * MOVO-133: persiste `phone` + `phoneVerified=true` en el mismo UPDATE -- se llama
   * solo después de que el OTP al teléfono nuevo ya probó posesión. Lanza
   * `UserConflictError("phone")` si `users_phone_key` rechaza el valor (carrera de
   * unicidad entre el paso 1 -- `POST /me/phone/change/otp` -- y este UPDATE).
   */
  updatePhone(id: string, phone: string): Promise<User | null>;
  /**
   * MOVO-133: lanza `UserConflictError("email")` si `users_email_key` (mismo casing
   * exacto) o `users_email_lower_idx` (MOVO-93: UNIQUE INDEX funcional sobre
   * LOWER(email) -- sí fuerza unicidad case-insensitive a nivel de DB, pese a lo que
   * decía este comentario antes) rechazan el valor. El chequeo explícito de
   * `users.service.ts#requestEmailChange`/`verifyEmailChange` (vía `findByEmail`)
   * sigue existiendo para devolver el 409 sin pagar el viaje a la DB en el caso común,
   * pero este catch es la última línea de defensa real contra la carrera de AC5.
   */
  updateEmail(id: string, email: string): Promise<User | null>;
  /**
   * MOVO-139: marca como verificado el email que la cuenta YA tiene
   * (`POST /users/me/email/verify/confirm`) -- se llama solo después de que el OTP
   * mandado a esa misma dirección probó propiedad. No toca `email`, a diferencia de
   * `updateEmail`, así que no puede colisionar con la unicidad de ninguna otra cuenta.
   */
  markEmailVerified(id: string): Promise<User | null>;
  /**
   * Búsqueda de receptor (AC3 de MOVO-80) por nombre completo — no existe columna
   * `username` en este modelo. Excluye al propio caller.
   */
  search(query: string, excludeUserId: string, limit: number): Promise<User[]>;
  /** MOVO-134: `POST /users/me/password`, después de verificar la contraseña actual. */
  updatePassword(id: string, passwordHash: string): Promise<User | null>;
  /**
   * MOVO-134: soft-delete + anonimización de PII en un solo UPDATE. `email`/`phone`
   * se derivan del propio `id` (ya único), así que nunca pueden colisionar con otro
   * usuario -- no hace falta capturar P2002 acá, a diferencia de `create()`.
   * `dni`/`birthdate`/`photoUrl` a `NULL`; `firstName`/`lastName` a un placeholder;
   * `phoneVerified` a `false` (el teléfono anonimizado nunca estuvo verificado). No
   * borra la fila (el `user_id` está referenciado desde envíos históricos en
   * `svc-shipments`, la integridad referencial del historial tiene que sobrevivir).
   */
  anonymizeAndDelete(id: string): Promise<User | null>;
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
    emailVerified: row.emailVerified,
    emailVerifiedAt: row.emailVerifiedAt,
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

/**
 * `uniqueConstraintFields()` matchea exacto para un unique constraint de columna
 * simple (`fields: ["email"]`), pero `users_email_lower_idx` (MOVO-93) es un UNIQUE
 * INDEX de EXPRESIÓN sobre `LOWER(email)` -- verificado empíricamente contra Postgres
 * real (ver historial de esta rama): para ese índice, el parseo del driver adapter no
 * devuelve `[]` como documentaba este archivo antes, devuelve `["lower(email::text"]`
 * (el nombre de la expresión, truncado en un paréntesis interno). Un `.includes(column)`
 * exacto no matchea eso -- el P2002 se repropaga crudo y el caller ve 500 en vez de
 * 409 justo en la carrera que AC5 existe para cubrir. `.some(f => f.includes(column))`
 * matchea las dos formas sin depender de parsear `originalMessage`.
 */
function uniqueConstraintFieldsInclude(error: Prisma.PrismaClientKnownRequestError, column: string): boolean {
  return uniqueConstraintFields(error).some((field) => field.includes(column));
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
          if (uniqueConstraintFieldsInclude(error, "email")) {
            throw new UserConflictError("email");
          }
          if (uniqueConstraintFieldsInclude(error, "phone")) {
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

    async swapPhotoUrl(
      id: string,
      photoUrl: string | null
    ): Promise<{ user: User; previousPhotoUrl: string | null } | null> {
      // MOVO-115: mismo mecanismo de row-lock que offer-repository.ts#acceptOffer /
      // shipment-repository.ts#updateStatus (MOVO-102/MOVO-118) -- bajo READ
      // COMMITTED, el `updateMany` toma un lock exclusivo de fila; si otro
      // `swapPhotoUrl` concurrente ganó la carrera entre el `findUnique` y este
      // `updateMany`, el WHERE se reevalúa contra el dato ya commiteado (EvalPlanQual)
      // y `count` da 0. A diferencia de esos dos casos no hay una transición inválida
      // que rechazar acá -- cualquier `photoUrl` nuevo es válido -- así que en vez de
      // lanzar un error de concurrencia se reintenta hasta ganar, para que
      // `previousPhotoUrl` sea siempre el valor que este swap realmente pisó (nunca el
      // que leyó una llamada concurrente que ya perdió la carrera). Tope de reintentos
      // como defensa en profundidad: solo se agotaría con una tasa de escritura sobre
      // la misma fila que este endpoint no genera (siempre el propio usuario, nunca un
      // fan-in de terceros).
      const MAX_ATTEMPTS = 10;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const current = await db.user.findUnique({ where: { id }, include: { roles: true } });
        if (!current) {
          return null;
        }
        const result = await db.user.updateMany({
          where: { id, photoUrl: current.photoUrl },
          data: { photoUrl },
        });
        if (result.count === 1) {
          return { user: toDomainUser({ ...current, photoUrl }), previousPhotoUrl: current.photoUrl };
        }
      }
      throw new Error(
        `swapPhotoUrl: no se pudo aplicar el compare-and-swap para el usuario '${id}' tras ${MAX_ATTEMPTS} intentos`
      );
    },

    async existsByPhotoUrl(photoUrl: string): Promise<boolean> {
      const row = await db.user.findFirst({ where: { photoUrl }, select: { id: true } });
      return row !== null;
    },

    async updateProfile(id: string, input: { firstName?: string; lastName?: string }): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: {
            ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
            ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          },
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

    async updatePhone(id: string, phone: string): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: { phone, phoneVerified: true },
          include: { roles: true },
        });
        return toDomainUser(row);
      } catch (error) {
        if (isRecordNotFoundError(error)) {
          return null;
        }
        if (isUniqueConstraintError(error) && uniqueConstraintFieldsInclude(error, "phone")) {
          throw new UserConflictError("phone");
        }
        throw error;
      }
    },

    async updateEmail(id: string, email: string): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          // MOVO-139 (AC4): `email` y `emailVerified` se persisten en el mismo UPDATE
          // -- el OTP que habilita esta llamada viajó al email NUEVO, así que llegar
          // acá ya es prueba de propiedad. Mismo criterio que `phone`/`phoneVerified`
          // en `updatePhone` (MOVO-133).
          data: { email, emailVerified: true, emailVerifiedAt: new Date() },
          include: { roles: true },
        });
        return toDomainUser(row);
      } catch (error) {
        if (isRecordNotFoundError(error)) {
          return null;
        }
        if (isUniqueConstraintError(error) && uniqueConstraintFieldsInclude(error, "email")) {
          throw new UserConflictError("email");
        }
        throw error;
      }
    },

    async markEmailVerified(id: string): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: { emailVerified: true, emailVerifiedAt: new Date() },
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
        // Mismo criterio que `getPublicProfile` (users.service.ts): `deleted` es baja
        // lógica y se trata como "no existe" hacia afuera; `banned` sí es buscable
        // (sanción reversible, no una baja voluntaria).
        where: { AND: [{ id: { not: excludeUserId } }, { status: { not: PrismaAccountStatus.deleted } }, { OR: or }] },
        include: { roles: true },
        take: limit,
        orderBy: { firstName: "asc" },
      });
      return rows.map(toDomainUser);
    },

    async updatePassword(id: string, passwordHash: string): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: { passwordHash },
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

    async anonymizeAndDelete(id: string): Promise<User | null> {
      try {
        const row = await db.user.update({
          where: { id },
          data: {
            status: PrismaAccountStatus.deleted,
            email: `deleted+${id}@movo.invalid`,
            phone: `deleted-${id}`,
            firstName: "Usuario",
            lastName: "eliminado",
            dni: null,
            birthdate: null,
            photoUrl: null,
            phoneVerified: false,
            // MOVO-139: mismo criterio que `phoneVerified` -- el email anonimizado
            // (`deleted+{id}@movo.invalid`) nunca estuvo verificado.
            emailVerified: false,
            emailVerifiedAt: null,
          },
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
  };
}
