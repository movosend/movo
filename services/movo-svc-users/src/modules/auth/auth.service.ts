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
import { createSessionRepository, SessionRepository } from "../../repositories/session-repository";
import { User, UserConflictError, CreateUserAddressInput, fullName } from "../../models/user";
import type { PhoneVerificationService } from "./phone-verification.service";

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
  // MOVO-72: emitido por POST /auth/verify-otp (MOVO-71), single-use — se consume acá
  // antes de crear la cuenta para setear phoneVerified=true (AC2 de MOVO-72 depende de
  // este flag, que hasta esta US nunca se seteaba).
  phoneVerificationToken: string;
  // MOVO-73: DNI y primera dirección (con lat/long ya confirmados por el paso de mapa
  // del wizard) -- ver auth.schema.ts#registerBody.
  dni: string;
  address: CreateUserAddressInput;
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

// register() emite el mismo shape que login() (revisión de PR #51, tmvergara): el
// estándar de industria en onboarding con KYC es que el registro autentica — el AC1
// original de MOVO-72 ("crea una sesión [...] para el usuario autenticado") asumía
// esto, y las rutas públicas de /kyc/session y /kyc/status eran un desvío forzado por
// no tenerlo. Con esto, ese desvío deja de ser necesario.
export type RegisterUserResult = LoginUserResult;

/** Misma forma que `LoginUserResult`: refrescar emite un par de tokens nuevo igual que un login. */
export type RefreshTokenResult = LoginUserResult;

export interface LogoutInput {
  refreshToken: string;
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

/**
 * Emite un par access/refresh token nuevo para `user` y persiste la sesión. Standalone
 * (no un closure de `createAuthService`) desde MOVO-134: `users.service.ts#changePassword`
 * necesita emitir el mismo shape de tokens sin tener que instanciar
 * `phoneVerificationService` (dependencia de `createAuthService` que no le hace falta).
 */
export async function issueSession(sessionRepository: SessionRepository, user: User): Promise<LoginUserResult> {
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
    fullName: fullName(user),
    roles: user.roles,
  };
}

export function createAuthService(
  db: PrismaClient,
  redis: Redis,
  phoneVerificationService: Pick<
    PhoneVerificationService,
    "consumePhoneVerificationToken" | "releasePhoneVerificationToken"
  >
) {
  const repository = createUserRepository(db);
  const sessionRepository = createSessionRepository(redis);

  return {
    async register(input: RegisterUserInput): Promise<RegisterUserResult> {
      const email = input.email.trim().toLowerCase();
      const phone = normalizePhoneToE164Ar(input.phone);
      const { firstName, lastName } = splitFullName(input.fullName);

      // Valida y consume el token ANTES de crear el usuario (single-use, AC6 de
      // MOVO-71): si el token es inválido/expirado/ya usado, tira ApiError(401,
      // "AUTH_OTP_INVALID", ...) y no llega a tocar la DB de usuarios.
      const { jti } = await phoneVerificationService.consumePhoneVerificationToken(
        input.phoneVerificationToken,
        phone
      );

      // Argon2id (AC6): resistente tanto a ataques de canal lateral (side-channel,
      // cubierto por Argon2i) como a fuerza bruta con hardware (GPU/ASIC, cubierto
      // por Argon2d) — recomendación OWASP para hash de contraseñas.
      const passwordHash = await hash(input.password, { algorithm: ARGON2ID });

      let user;
      try {
        user = await repository.create({
          email,
          phone,
          firstName,
          lastName,
          passwordHash,
          dni: input.dni,
          phoneVerified: true,
          roles: DEFAULT_USER_ROLES,
          address: input.address,
        });
      } catch (err) {
        // El token ya se consumió arriba; si el registro no prospera se libera para que
        // un reintento no tenga que rehacer el OTP (revisión de PR #51, tmvergara —
        // repro: un typo en el email obligaba a pedir un código nuevo aunque el teléfono
        // siguiera verificado).
        //
        // Se libera ante CUALQUIER causa de falla de `create()`, no solo el conflicto de
        // datos (revisión de PR #52, JcBordino4): un error de DB, o de la escritura nueva
        // de `address`, dejaba el token quemado por algo que no tuvo nada que ver con el
        // teléfono. Es seguro porque `create()` es un nested write de Prisma, atómico
        // (usuario + roles + dirección): si tiró, no quedó ninguna cuenta a medias y el
        // teléfono sigue tan verificado como antes.
        //
        // El `catch` propio evita enmascarar el error original si Redis no responde: el
        // caller tiene que ver la causa real, no un fallo de la liberación.
        await phoneVerificationService.releasePhoneVerificationToken(jti).catch(() => undefined);

        if (err instanceof UserConflictError) {
          if (err.field === "email") {
            throw new ApiError(409, "USER_EMAIL_ALREADY_EXISTS", "Ya existe una cuenta registrada con este email.");
          }
          throw new ApiError(409, "USER_PHONE_ALREADY_EXISTS", "Ya existe una cuenta registrada con este teléfono.");
        }
        throw err;
      }

      return issueSession(sessionRepository, user);
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

      return issueSession(sessionRepository, user);
    },

    async refresh(refreshToken: string): Promise<RefreshTokenResult> {
      const parsed = parseRefreshToken(refreshToken);
      if (!parsed) {
        throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
      }
      const { userId, tokenId, secret } = parsed;

      // Lee + chequea `used` + marca `used: true` en una sola operación atómica
      // (script Lua) — evita la carrera de dos refresh concurrentes con el mismo
      // token pasando el chequeo antes de que cualquiera escriba `used: true`.
      const result = await sessionRepository.consumeRefreshToken(userId, tokenId, hashRefreshSecret(secret));

      if (result === "already-used") {
        // Reuso de un refresh ya rotado: señal de robo (AC3) — se revocan todas
        // las sesiones del usuario, no solo la de este token.
        await sessionRepository.revokeAllForUser(userId);
        throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
      }
      if (result === "not-found" || result === "hash-mismatch") {
        throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
      }

      const user = await repository.findById(userId);
      if (!user || user.status === AccountStatus.BANNED || user.status === AccountStatus.DELETED) {
        await sessionRepository.revokeAllForUser(userId);
        if (!user) {
          throw new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");
        }
        throw new ApiError(403, "ACCOUNT_SUSPENDED", "La cuenta se encuentra suspendida o inhabilitada.");
      }

      // AC5: roles/kycStatus releídos de la fila actual, no del token viejo.
      return issueSession(sessionRepository, user);
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
