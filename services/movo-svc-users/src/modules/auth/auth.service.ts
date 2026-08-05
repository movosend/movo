import { createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import Redis from "ioredis";
import { PrismaClient } from "../../generated/prisma/client";
import {
  ApiError,
  KycStatus,
  UserRole,
  AccountStatus,
  signAccessToken,
  signRefreshToken,
} from "@movo/shared";
import { createUserRepository } from "../../repositories/user-repository";
import { createSessionRepository } from "../../repositories/session-repository";
import { User, UserConflictError } from "../../models/user";

/** Roles por defecto al registrarse (AC8): todo usuario puede operar como emisor y transportista. */
const DEFAULT_USER_ROLES: UserRole[] = [UserRole.SENDER, UserRole.CARRIER];

// @node-rs/argon2 exporta `Algorithm` como `const enum`, incompatible con
// `isolatedModules` (tsconfig del servicio) — se usa el valor numérico de
// `Algorithm.Argon2id` directamente en vez de importar el enum.
const ARGON2ID = 2;

// Hash sintético constante para ejecutar verificación Argon2id cuando el usuario
// no existe, evitando ataques de tiempo (timing attacks / enumeración de usuarios).
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RkJWb2lMNzJ2ZzBvV0RzTE4xQ3pndw";

export interface RegisterUserInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}

export interface RegisterUserResult {
  userId: string;
  kycStatus: KycStatus;
}

export interface LoginUserInput {
  phone: string;
  password: string;
}

export interface LoginUserResult {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  kycStatus: KycStatus;
  fullName: string;
  roles: UserRole[];
}

/** Misma forma que `LoginUserResult`: refrescar emite un par de tokens nuevo igual que un login. */
export type RefreshTokenResult = LoginUserResult;

export interface LogoutInput {
  refreshToken: string;
}

/** Registro persistido en Redis bajo `refresh:{userId}:{tokenId}` (MOVO-75). */
interface RefreshTokenRecord {
  hash: string;
  used: boolean;
}

/**
 * El `refreshToken` que recibe el cliente es un token opaco *compuesto*, no el
 * secreto crudo que emite `signRefreshToken()`: `"{userId}.{tokenId}.{secret}"`.
 * Sin el `userId`/`tokenId` embebidos no hay forma de ubicar la key
 * `refresh:{userId}:{tokenId}` en Redis a partir de lo único que tiene el
 * cliente — ninguno de los tres componentes puede contener un punto (UUID o
 * base64url), así que el split es seguro.
 */
function buildRefreshToken(userId: string, tokenId: string, secret: string): string {
  return `${userId}.${tokenId}.${secret}`;
}

function parseRefreshToken(refreshToken: string): { userId: string; tokenId: string; secret: string } | null {
  const parts = refreshToken.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [userId, tokenId, secret] = parts;
  if (!userId || !tokenId || !secret) {
    return null;
  }
  return { userId, tokenId, secret };
}

/**
 * SHA-256 (no Argon2id): `secret` ya son 256 bits de aleatoriedad criptográfica
 * generados por `signRefreshToken()`, no una contraseña de usuario — alcanza con
 * una comparación honesta, no hace falta un hash lento.
 */
function hashRefreshSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Separa `fullName` en nombre/apellido para las columnas `first_name`/
 * `last_name` de la migración de MOVO-66 (que no tiene un único campo
 * `full_name`). El schema de la ruta exige al menos dos palabras, así que
 * `lastName` siempre queda no vacío.
 */
export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = fullName.trim().replace(/\s+/g, " ").split(" ");
  if (!firstName || rest.length === 0) {
    throw new Error("fullName debe tener al menos nombre y apellido");
  }
  return { firstName, lastName: rest.join(" ") };
}

/**
 * Normaliza un teléfono argentino a E.164 (`+549` + 10 dígitos), sin
 * importar si el usuario incluyó "+54", "9", ambos o ninguno — de otro modo
 * la unicidad de teléfono (AC4) es inútil: "3511234567" y "+543511234567"
 * son el mismo número y pasarían la validación de unicidad los dos.
 */
export function normalizePhoneToE164Ar(rawPhone: string): string {
  let digits = rawPhone.replace(/\D/g, "");
  if (digits.startsWith("54")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("9")) {
    digits = digits.slice(1);
  }
  return `+549${digits}`;
}

export function createAuthService(db: PrismaClient, redis: Redis) {
  const repository = createUserRepository(db);
  const sessionRepository = createSessionRepository(redis);

  /** Emite un par access/refresh token nuevo para `user` y persiste la sesión — usado por login() y refresh(). */
  async function issueSession(user: User): Promise<LoginUserResult> {
    const accessToken = signAccessToken({
      sub: user.id,
      roles: user.roles,
      kycStatus: user.kycStatusIdentity,
    });

    const { token: secret, tokenId } = signRefreshToken();
    await sessionRepository.saveRefreshToken(user.id, tokenId, {
      hash: hashRefreshSecret(secret),
      used: false,
    });

    return {
      userId: user.id,
      accessToken,
      refreshToken: buildRefreshToken(user.id, tokenId, secret),
      expiresIn: 3600,
      kycStatus: user.kycStatusIdentity,
      fullName: `${user.firstName} ${user.lastName}`,
      roles: user.roles,
    };
  }

  return {
    async register(input: RegisterUserInput): Promise<RegisterUserResult> {
      const email = input.email.trim().toLowerCase();
      const phone = normalizePhoneToE164Ar(input.phone);
      const { firstName, lastName } = splitFullName(input.fullName);
      // Argon2id (AC6): resistente tanto a ataques de canal lateral (side-channel,
      // cubierto por Argon2i) como a fuerza bruta con hardware (GPU/ASIC, cubierto
      // por Argon2d) — recomendación OWASP para hash de contraseñas.
      const passwordHash = await hash(input.password, { algorithm: ARGON2ID });

      try {
        const user = await repository.create({
          email,
          phone,
          firstName,
          lastName,
          passwordHash,
          roles: DEFAULT_USER_ROLES,
        });
        return { userId: user.id, kycStatus: user.kycStatusIdentity };
      } catch (err) {
        if (err instanceof UserConflictError) {
          if (err.field === "email") {
            throw new ApiError(409, "USER_EMAIL_ALREADY_EXISTS", "Ya existe una cuenta registrada con este email.");
          }
          throw new ApiError(409, "USER_PHONE_ALREADY_EXISTS", "Ya existe una cuenta registrada con este teléfono.");
        }
        throw err;
      }
    },

    async login(input: LoginUserInput): Promise<LoginUserResult> {
      const phone = normalizePhoneToE164Ar(input.phone);
      const user = await repository.findByPhone(phone);

      if (!user) {
        // Prevenir timing attack: ejecutar verificación Argon2id contra dummy hash
        try {
          await verify(DUMMY_HASH, input.password);
        } catch {
          // ignora error de formato si dummy hash fuera rechazado
        }
        throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.");
      }

      const isValidPassword = await verify(user.passwordHash, input.password);
      if (!isValidPassword) {
        throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.");
      }

      if (user.status === AccountStatus.BANNED || user.status === AccountStatus.DELETED) {
        throw new ApiError(403, "ACCOUNT_SUSPENDED", "La cuenta se encuentra suspendida o inhabilitada.");
      }

      return issueSession(user);
    },

    async refresh(refreshToken: string): Promise<RefreshTokenResult> {
      const parsed = parseRefreshToken(refreshToken);
      if (!parsed) {
        throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
      }
      const { userId, tokenId, secret } = parsed;

      const stored = await sessionRepository.findRefreshToken(userId, tokenId);
      if (!stored) {
        throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
      }

      const record = JSON.parse(stored) as RefreshTokenRecord;
      if (record.hash !== hashRefreshSecret(secret)) {
        throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
      }

      if (record.used) {
        // Reuso de un refresh ya rotado: señal de robo (AC3) — se revocan todas
        // las sesiones del usuario, no solo la de este token.
        await sessionRepository.revokeAllForUser(userId);
        throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
      }

      // Un solo uso (AC2): antes de emitir el par nuevo, esta sesión queda marcada
      // como usada — cualquier reintento con el mismo token cae en la rama de arriba.
      await sessionRepository.saveRefreshToken(userId, tokenId, { hash: record.hash, used: true });

      const user = await repository.findById(userId);
      if (!user || user.status === AccountStatus.BANNED || user.status === AccountStatus.DELETED) {
        await sessionRepository.revokeAllForUser(userId);
        if (!user) {
          throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
        }
        throw new ApiError(403, "ACCOUNT_SUSPENDED", "La cuenta se encuentra suspendida o inhabilitada.");
      }

      // AC5: roles/kycStatus releídos de la fila actual, no del token viejo.
      return issueSession(user);
    },

    async logout(input: LogoutInput, requestUserId: string): Promise<void> {
      const parsed = parseRefreshToken(input.refreshToken);
      // Idempotente por diseño (AC9): token inválido, ya revocado, o de otro
      // usuario no distingue error — siempre es un no-op silencioso.
      if (!parsed || parsed.userId !== requestUserId) {
        return;
      }
      await sessionRepository.revokeRefreshToken(parsed.userId, parsed.tokenId);
    },

    async logoutAll(userId: string): Promise<void> {
      await sessionRepository.revokeAllForUser(userId);
    },
  };
}
