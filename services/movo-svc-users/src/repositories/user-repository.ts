import { Pool, PoolClient } from "pg";
import { KycStatus } from "@movo/shared";
import {
  User,
  UserRow,
  CreateUserInput,
  UserConflictError,
  mapRowToUser,
  roleToDb,
  kycStatusToDb,
} from "../models/user";

export interface UserRepository {
  count(): Promise<number>;
  findByEmail(email: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
  updateKycStatusIdentity(id: string, status: KycStatus): Promise<User | null>;
  updateKycStatusLicense(id: string, status: KycStatus): Promise<User | null>;
}

// Constraints reales de la migración 20260728160000_create_users_schema.sql
// que pueden disparar un 23505 al insertar en users.users.
const EMAIL_CONFLICT_CONSTRAINTS = new Set(["users_email_key", "users_email_lower_idx"]);
const PHONE_CONFLICT_CONSTRAINTS = new Set(["users_phone_key"]);

// `ur.role::text` es necesario: `pg` no conoce el OID de un enum custom de
// Postgres y por eso no puede parsear `array_agg(ur.role)` como array JS
// (lo devuelve como el string literal "{emisor,transportista}"). Castear a
// `text` antes de agregarlo hace que sea un `text[]` real, que `pg` sí sabe
// parsear a un array de JS.
const SELECT_USER_WITH_ROLES = `
  SELECT u.*, COALESCE(array_agg(ur.role::text) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
  FROM users.users u
  LEFT JOIN users.user_roles ur ON ur.user_id = u.id
`;

interface UserRowWithRoles extends UserRow {
  roles: string[];
}

function toUserOrNull(row: UserRowWithRoles | undefined): User | null {
  if (!row) {
    return null;
  }
  return mapRowToUser(row, row.roles);
}

export function createUserRepository(db: Pool): UserRepository {
  return {
    async count(): Promise<number> {
      const result = await db.query<{ count: string }>("SELECT COUNT(*)::int AS count FROM users.users");
      return Number(result.rows[0]?.count ?? 0);
    },

    async findByEmail(email: string): Promise<User | null> {
      const result = await db.query<UserRowWithRoles>(
        `${SELECT_USER_WITH_ROLES} WHERE LOWER(u.email) = LOWER($1) GROUP BY u.id`,
        [email]
      );
      return toUserOrNull(result.rows[0]);
    },

    async findByPhone(phone: string): Promise<User | null> {
      const result = await db.query<UserRowWithRoles>(
        `${SELECT_USER_WITH_ROLES} WHERE u.phone = $1 GROUP BY u.id`,
        [phone]
      );
      return toUserOrNull(result.rows[0]);
    },

    async findById(id: string): Promise<User | null> {
      const result = await db.query<UserRowWithRoles>(
        `${SELECT_USER_WITH_ROLES} WHERE u.id = $1 GROUP BY u.id`,
        [id]
      );
      return toUserOrNull(result.rows[0]);
    },

    async create(input: CreateUserInput): Promise<User> {
      const client: PoolClient = await db.connect();
      try {
        await client.query("BEGIN");

        const insertResult = await client.query<UserRow>(
          `INSERT INTO users.users (email, phone, first_name, last_name, password_hash, dni)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [input.email, input.phone, input.firstName, input.lastName, input.passwordHash, input.dni ?? null]
        );
        // Garantizado por RETURNING * de un INSERT exitoso.
        const userRow = insertResult.rows[0]!;

        for (const role of input.roles) {
          await client.query(
            `INSERT INTO users.user_roles (user_id, role) VALUES ($1, $2)`,
            [userRow.id, roleToDb(role)]
          );
        }

        // Relee la fila ya persistida en vez de devolver los roles derivados
        // del input: así lo que sale refleja el estado definitivo de la DB
        // (defaults, triggers, normalizaciones) y no lo que se pidió insertar.
        // Va con el mismo `client` y dentro de la transacción, que ve sus
        // propias escrituras aún sin COMMIT.
        const finalResult = await client.query<UserRowWithRoles>(
          `${SELECT_USER_WITH_ROLES} WHERE u.id = $1 GROUP BY u.id`,
          [userRow.id]
        );

        await client.query("COMMIT");

        // Garantizado: la fila se acaba de insertar en esta misma transacción.
        return toUserOrNull(finalResult.rows[0])!;
      } catch (error) {
        await client.query("ROLLBACK");

        if (isUniqueViolation(error)) {
          const constraint = error.constraint ?? "";
          if (EMAIL_CONFLICT_CONSTRAINTS.has(constraint)) {
            throw new UserConflictError("email");
          }
          if (PHONE_CONFLICT_CONSTRAINTS.has(constraint)) {
            throw new UserConflictError("phone");
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async updateKycStatusIdentity(id: string, status: KycStatus): Promise<User | null> {
      const result = await db.query<UserRow>(
        `UPDATE users.users SET kyc_status_identity = $1 WHERE id = $2 RETURNING *`,
        [kycStatusToDb(status), id]
      );
      const userRow = result.rows[0];
      if (!userRow) {
        return null;
      }
      const roles = await fetchRoles(db, userRow.id);
      return mapRowToUser(userRow, roles);
    },

    async updateKycStatusLicense(id: string, status: KycStatus): Promise<User | null> {
      const result = await db.query<UserRow>(
        `UPDATE users.users SET kyc_status_license = $1 WHERE id = $2 RETURNING *`,
        [kycStatusToDb(status), id]
      );
      const userRow = result.rows[0];
      if (!userRow) {
        return null;
      }
      const roles = await fetchRoles(db, userRow.id);
      return mapRowToUser(userRow, roles);
    },
  };
}

async function fetchRoles(db: Pool, userId: string): Promise<string[]> {
  const result = await db.query<{ role: string }>(
    "SELECT role FROM users.user_roles WHERE user_id = $1",
    [userId]
  );
  return result.rows.map((row) => row.role);
}

function isUniqueViolation(error: unknown): error is { code: "23505"; constraint?: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
