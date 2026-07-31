import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { ApiError, KycStatus } from "@movo/shared";
import { createAuthRepository, DuplicateUserError } from "./auth.repository";

// @node-rs/argon2 exporta `Algorithm` como `const enum`, incompatible con
// `isolatedModules` (tsconfig del servicio) — se usa el valor numérico de
// `Algorithm.Argon2id` directamente en vez de importar el enum.
const ARGON2ID = 2;

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

export function createAuthService(db: Pool) {
  const repository = createAuthRepository(db);

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
        const user = await repository.createUser({ email, phone, firstName, lastName, passwordHash });
        return { userId: user.id, kycStatus: user.kycStatus };
      } catch (err) {
        if (err instanceof DuplicateUserError) {
          if (err.field === "email") {
            throw new ApiError(409, "USER_EMAIL_ALREADY_EXISTS", "Ya existe una cuenta registrada con este email.");
          }
          throw new ApiError(409, "USER_PHONE_ALREADY_EXISTS", "Ya existe una cuenta registrada con este teléfono.");
        }
        throw err;
      }
    },
  };
}
