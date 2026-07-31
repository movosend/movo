import { Pool, PoolClient } from "pg";
import { KycStatus } from "@movo/shared";

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  /** Ya normalizado a minúsculas por el service (AC5). */
  email: string;
  /** Ya normalizado a E.164 argentino por el service (guía de MOVO-70). */
  phone: string;
  passwordHash: string;
}

export interface CreatedUser {
  id: string;
  kycStatus: KycStatus;
}

export type DuplicateField = "email" | "phone";

export class DuplicateUserError extends Error {
  constructor(public readonly field: DuplicateField) {
    super(`duplicate ${field}`);
    this.name = "DuplicateUserError";
  }
}

/**
 * Roles por defecto al registrarse (AC8): cualquier usuario puede operar
 * como emisor y como transportista. Los valores de `users.user_role_enum`
 * están en español y no coinciden con el enum `UserRole` de @movo/shared
 * (inglés) — inconsistencia entre MOVO-66/87 y MOVO-67 documentada en
 * CLAUDE.md, pendiente de unificación por el equipo.
 */
const DEFAULT_USER_ROLES = ["emisor", "transportista"] as const;

export interface AuthRepository {
  createUser(input: CreateUserInput): Promise<CreatedUser>;
}

export function createAuthRepository(db: Pool): AuthRepository {
  return {
    async createUser(input: CreateUserInput): Promise<CreatedUser> {
      const client: PoolClient = await db.connect();
      try {
        await client.query("BEGIN");

        const result = await client.query<{ id: string }>(
          `INSERT INTO users.users (email, phone, first_name, last_name, password_hash)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [input.email, input.phone, input.firstName, input.lastName, input.passwordHash]
        );

        const userId = result.rows[0]?.id;
        if (!userId) {
          throw new Error("no id returned after inserting user");
        }

        for (const role of DEFAULT_USER_ROLES) {
          await client.query(`INSERT INTO users.user_roles (user_id, role) VALUES ($1, $2)`, [userId, role]);
        }

        await client.query("COMMIT");

        return { id: userId, kycStatus: KycStatus.NOT_STARTED };
      } catch (err) {
        await client.query("ROLLBACK");
        throw toDuplicateUserError(err) ?? err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * AC3/AC4 exigen 409 en duplicado. En vez de un SELECT previo (que deja una
 * ventana de carrera entre el chequeo y el INSERT), se confía en los índices
 * únicos de la migración y se traduce la violación de Postgres (23505) al
 * campo correspondiente.
 */
function toDuplicateUserError(err: unknown): DuplicateUserError | undefined {
  if (typeof err !== "object" || err === null || (err as { code?: string }).code !== "23505") {
    return undefined;
  }

  const constraint = (err as { constraint?: string }).constraint;
  if (constraint === "users_email_lower_idx" || constraint === "users_email_key") {
    return new DuplicateUserError("email");
  }
  if (constraint === "users_phone_key") {
    return new DuplicateUserError("phone");
  }
  return undefined;
}
