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
import { UserConflictError } from "../../models/user";
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

export function createAuthService(
  db: PrismaClient,
  redis: Redis,
  phoneVerificationService: Pick<PhoneVerificationService, "consumePhoneVerificationToken">
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
      await phoneVerificationService.consumePhoneVerificationToken(input.phoneVerificationToken, phone);

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
          phoneVerified: true,
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

      const accessToken = signAccessToken({
        sub: user.id,
        roles: user.roles,
        kycStatus: user.kycStatusIdentity,
      });

      const { token: refreshToken, tokenId } = signRefreshToken();
      await sessionRepository.saveRefreshToken(user.id, tokenId, refreshToken);

      return {
        userId: user.id,
        accessToken,
        refreshToken,
        expiresIn: 3600,
        kycStatus: user.kycStatusIdentity,
        fullName: `${user.firstName} ${user.lastName}`,
        roles: user.roles,
      };
    },
  };
}
