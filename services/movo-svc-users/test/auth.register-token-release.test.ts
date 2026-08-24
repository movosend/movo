import { describe, it, expect } from "vitest";
import type { Redis } from "ioredis";
import { PrismaClient } from "../src/generated/prisma/client";
import { createAuthService } from "../src/modules/auth/auth.service";
import { UserConflictError } from "../src/models/user";

/**
 * Revisión de PR #52 (JcBordino4): `register()` consume el `phoneVerificationToken`
 * (single-use) ANTES de crear el usuario, así que toda falla de `create()` tiene que
 * devolver ese uso — no solo el conflicto de email/teléfono. Si no, un error de DB o de
 * la escritura de `address` quema el token y obliga a rehacer todo el OTP por algo que
 * no tuvo nada que ver con el teléfono.
 *
 * Va como test unitario y no de integración porque la causa de falla que importa es
 * justamente la que no se puede provocar contra una DB sana: se stubea el `create()`
 * para que tire. Redis nunca se toca en este camino (`issueSession` queda después del
 * throw), así que alcanza con un stub vacío.
 */
function buildServiceWithFailingCreate(error: Error) {
  const releasedJtis: string[] = [];

  const db = {
    user: {
      create: async () => {
        throw error;
      },
    },
  } as unknown as PrismaClient;

  const service = createAuthService(db, {} as unknown as Redis, {
    async consumePhoneVerificationToken(_token: string, phone: string) {
      return { phone, jti: "jti-de-prueba" };
    },
    async releasePhoneVerificationToken(jti: string) {
      releasedJtis.push(jti);
    },
  });

  return { service, releasedJtis };
}

const REGISTER_INPUT = {
  fullName: "Juan Perez",
  email: "juan@example.com",
  phone: "3511234567",
  password: "Password1",
  phoneVerificationToken: "token",
  dni: "30123456",
  address: {
    street: "Av. Colón",
    number: "1234",
    city: "Córdoba",
    province: "Córdoba",
    zip: "5000",
    lat: -31.4201,
    long: -64.1888,
  },
};

describe("register() — liberación del phoneVerificationToken (revisión PR #52)", () => {
  it("libera el token si la creación falla por una causa ajena al teléfono (ej. error de DB)", async () => {
    const dbError = new Error("no se pudo escribir la dirección");
    const { service, releasedJtis } = buildServiceWithFailingCreate(dbError);

    // El error original se propaga tal cual: la liberación no lo enmascara.
    await expect(service.register(REGISTER_INPUT)).rejects.toBe(dbError);
    expect(releasedJtis).toEqual(["jti-de-prueba"]);
  });

  it("sigue liberando el token en el conflicto de email (comportamiento de PR #51, sin regresión)", async () => {
    const { service, releasedJtis } = buildServiceWithFailingCreate(new UserConflictError("email"));

    await expect(service.register(REGISTER_INPUT)).rejects.toMatchObject({
      statusCode: 409,
      code: "USER_EMAIL_ALREADY_EXISTS",
    });
    expect(releasedJtis).toEqual(["jti-de-prueba"]);
  });

  it("no enmascara el error del registro si la liberación en Redis también falla", async () => {
    const dbError = new Error("db caída");
    const db = {
      user: {
        create: async () => {
          throw dbError;
        },
      },
    } as unknown as PrismaClient;

    const service = createAuthService(db, {} as unknown as Redis, {
      async consumePhoneVerificationToken(_token: string, phone: string) {
        return { phone, jti: "jti-de-prueba" };
      },
      async releasePhoneVerificationToken() {
        throw new Error("redis caído");
      },
    });

    await expect(service.register(REGISTER_INPUT)).rejects.toBe(dbError);
  });
});
