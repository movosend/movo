import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { SmsProvider } from "../src/adapters/sms-provider";
import { ShipmentsClient } from "../src/adapters/shipments-client";
import { createMockStorageProvider, MockStorageProvider } from "../src/adapters/mock-storage-provider";
import { createUserRepository } from "../src/repositories/user-repository";

function createCaptorSmsProvider() {
  const sentCodes = new Map<string, string>();
  const provider: SmsProvider = {
    async send(toE164: string, code: string): Promise<void> {
      sentCodes.set(toE164, code);
    },
    async sendText(): Promise<void> {},
  };
  return { provider, sentCodes };
}

interface ActiveShipmentsResult {
  hasActiveDispute: boolean;
  hasActiveShipments: boolean;
}

function createFakeShipmentsClient() {
  const responses = new Map<string, ActiveShipmentsResult>();
  const client: ShipmentsClient = {
    async hasActiveShipments(userId: string): Promise<ActiveShipmentsResult> {
      return responses.get(userId) ?? { hasActiveDispute: false, hasActiveShipments: false };
    },
  };
  return {
    client,
    setResponse(userId: string, value: ActiveShipmentsResult) {
      responses.set(userId, value);
    },
  };
}

describe("Cambio de contraseña y baja de cuenta (MOVO-134)", () => {
  let app: FastifyInstance;
  let captor: ReturnType<typeof createCaptorSmsProvider>;
  let shipmentsFake: ReturnType<typeof createFakeShipmentsClient>;
  let storage: MockStorageProvider;

  const validRegisterPayload = {
    fullName: "Tomas Olmos",
    email: "tomasolmos04@example.com",
    phone: "3511234567",
    password: "Password1",
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

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    captor = createCaptorSmsProvider();
    shipmentsFake = createFakeShipmentsClient();
    storage = createMockStorageProvider();
    app = buildApp({ smsProvider: captor.provider, shipmentsClient: shipmentsFake.client, storageProvider: storage });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    let cursor = "0";
    do {
      const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", "refresh:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await app.redis.del(...keys);
      }
    } while (cursor !== "0");
    cursor = "0";
    do {
      const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", "otp:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await app.redis.del(...keys);
      }
    } while (cursor !== "0");
    for (const pattern of ["password-change-attempts:*", "user-revoked-at:*", "account-deletion-lock:*"]) {
      cursor = "0";
      do {
        const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await app.redis.del(...keys);
        }
      } while (cursor !== "0");
    }
  });

  /** Mismo helper que auth.login.integration.test.ts: /auth/register exige un phoneVerificationToken real. */
  async function registerFixtureUser(payload: typeof validRegisterPayload = validRegisterPayload) {
    const send = await app.inject({ method: "POST", url: "/auth/send-otp", payload: { phone: payload.phone } });
    const { otpId } = JSON.parse(send.body) as { otpId: string };
    const code = [...captor.sentCodes.values()].pop();
    if (!code) {
      throw new Error("No se capturó ningún código OTP");
    }
    const verify = await app.inject({ method: "POST", url: "/auth/verify-otp", payload: { otpId, code } });
    const { phoneVerificationToken } = JSON.parse(verify.body) as { phoneVerificationToken: string };
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...payload, phoneVerificationToken },
    });
    return JSON.parse(register.body) as {
      userId: string;
      accessToken: string;
      refreshToken: string;
    };
  }

  describe("POST /users/me/password", () => {
    it("con la contraseña actual correcta, cambia la contraseña y el login viejo deja de funcionar", async () => {
      const { userId } = await registerFixtureUser();

      const response = await app.inject({
        method: "POST",
        url: "/users/me/password",
        headers: { "x-user-id": userId },
        payload: { currentPassword: "Password1", newPassword: "NuevaPass2" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { userId: string; accessToken: string; refreshToken: string };
      expect(body.userId).toBe(userId);
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();

      // El gateway (plugins/auth.ts) es quien lee esta key para rechazar un access
      // token ya emitido -- acá solo se verifica el lado que escribe (MOVO-134).
      expect(await app.redis.get(`user-revoked-at:${userId}`)).toBeTruthy();

      const oldLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: validRegisterPayload.phone, password: "Password1" },
      });
      expect(oldLogin.statusCode).toBe(401);

      const newLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: validRegisterPayload.phone, password: "NuevaPass2" },
      });
      expect(newLogin.statusCode).toBe(200);
    });

    it("contraseña actual incorrecta -> 401, sin efecto sobre la contraseña ni las sesiones", async () => {
      const { userId } = await registerFixtureUser();

      const response = await app.inject({
        method: "POST",
        url: "/users/me/password",
        headers: { "x-user-id": userId },
        payload: { currentPassword: "Incorrecta1", newPassword: "NuevaPass2" },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_INVALID_CREDENTIALS");

      const stillWorks = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: validRegisterPayload.phone, password: "Password1" },
      });
      expect(stillWorks.statusCode).toBe(200);
    });

    it("después del cambio, un refresh token emitido antes ya no sirve, y el par devuelto sí", async () => {
      const { userId, refreshToken: oldRefreshToken } = await registerFixtureUser();

      const changeResponse = await app.inject({
        method: "POST",
        url: "/users/me/password",
        headers: { "x-user-id": userId },
        payload: { currentPassword: "Password1", newPassword: "NuevaPass2" },
      });
      const { refreshToken: newRefreshToken } = JSON.parse(changeResponse.body) as { refreshToken: string };

      const oldRefreshAttempt = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: oldRefreshToken },
      });
      expect(oldRefreshAttempt.statusCode).toBe(401);

      const newRefreshAttempt = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: newRefreshToken },
      });
      expect(newRefreshAttempt.statusCode).toBe(200);
    });

    it("contraseña nueva igual a la actual -> 400", async () => {
      const { userId } = await registerFixtureUser();

      const response = await app.inject({
        method: "POST",
        url: "/users/me/password",
        headers: { "x-user-id": userId },
        payload: { currentPassword: "Password1", newPassword: "Password1" },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("rate limit por usuario: 6ta llamada en la ventana -> 429, sin importar el resultado de las anteriores", async () => {
      const { userId } = await registerFixtureUser();

      for (let i = 0; i < 5; i++) {
        const attempt = await app.inject({
          method: "POST",
          url: "/users/me/password",
          headers: { "x-user-id": userId },
          payload: { currentPassword: "Incorrecta1", newPassword: "NuevaPass2" },
        });
        expect(attempt.statusCode).toBe(401);
      }

      const sixth = await app.inject({
        method: "POST",
        url: "/users/me/password",
        headers: { "x-user-id": userId },
        payload: { currentPassword: "Password1", newPassword: "NuevaPass2" },
      });
      expect(sixth.statusCode).toBe(429);
      expect(JSON.parse(sixth.body).error.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("un cambio exitoso resetea el contador de intentos fallidos", async () => {
      const { userId } = await registerFixtureUser();

      for (let i = 0; i < 4; i++) {
        const attempt = await app.inject({
          method: "POST",
          url: "/users/me/password",
          headers: { "x-user-id": userId },
          payload: { currentPassword: "Incorrecta1", newPassword: "NuevaPass2" },
        });
        expect(attempt.statusCode).toBe(401);
      }

      const success = await app.inject({
        method: "POST",
        url: "/users/me/password",
        headers: { "x-user-id": userId },
        payload: { currentPassword: "Password1", newPassword: "NuevaPass2" },
      });
      expect(success.statusCode).toBe(200);

      // Si el contador no se hubiera reseteado, este 5to intento fallido llegaría a 5
      // acumulados desde antes del éxito y el próximo (bajo el límite) ya estaría 429.
      for (let i = 0; i < 4; i++) {
        const attempt = await app.inject({
          method: "POST",
          url: "/users/me/password",
          headers: { "x-user-id": userId },
          payload: { currentPassword: "Incorrecta1", newPassword: "OtraPass3" },
        });
        expect(attempt.statusCode).toBe(401);
      }
      const stillUnderLimit = await app.inject({
        method: "POST",
        url: "/users/me/password",
        headers: { "x-user-id": userId },
        payload: { currentPassword: "NuevaPass2", newPassword: "OtraPass3" },
      });
      expect(stillUnderLimit.statusCode).toBe(200);
    });

    it("devuelve 401 AUTH_TOKEN_INVALID sin header x-user-id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/users/me/password",
        payload: { currentPassword: "Password1", newPassword: "NuevaPass2" },
      });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("DELETE /users/me", () => {
    it("con la contraseña correcta y sin envíos activos, deja la cuenta deleted, anonimizada y sin sesiones", async () => {
      const { userId, refreshToken } = await registerFixtureUser();

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });

      expect(response.statusCode).toBe(204);

      const repo = createUserRepository(app.db);
      const reloaded = await repo.findById(userId);
      expect(reloaded?.status).toBe("deleted");
      expect(reloaded?.email).toBe(`deleted+${userId}@movo.invalid`);
      expect(reloaded?.phone).toBe(`deleted-${userId}`);
      expect(reloaded?.dni).toBeNull();
      expect(reloaded?.birthdate).toBeNull();
      expect(reloaded?.photoUrl).toBeNull();
      expect(reloaded?.phoneVerified).toBe(false);

      const addresses = await app.db.address.findMany({ where: { userId } });
      expect(addresses).toEqual([]);

      // El gateway (plugins/auth.ts) es quien lee esta key para rechazar un access
      // token ya emitido -- acá solo se verifica el lado que escribe (MOVO-134).
      expect(await app.redis.get(`user-revoked-at:${userId}`)).toBeTruthy();

      const refreshAttempt = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken },
      });
      expect(refreshAttempt.statusCode).toBe(401);

      const loginAttempt = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: validRegisterPayload.phone, password: "Password1" },
      });
      expect(loginAttempt.statusCode).toBe(401);
    });

    it("borra los registros de KYC/licencia de conducir al dar de baja la cuenta", async () => {
      const { userId } = await registerFixtureUser();

      const kycVerification = await app.db.kycVerification.create({
        data: {
          userId,
          verificationType: "identity",
          provider: "didit",
          externalSessionId: `session-${userId}`,
          status: "approved",
          rawDecision: { foo: "bar" },
        },
      });
      await app.db.driversLicense.create({
        data: {
          userId,
          kycVerificationId: kycVerification.id,
          status: "verified",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });
      expect(response.statusCode).toBe(204);

      expect(await app.db.kycVerification.findMany({ where: { userId } })).toEqual([]);
      expect(await app.db.driversLicense.findMany({ where: { userId } })).toEqual([]);
    });

    it("AC4: borra la foto de perfil de S3 al dar de baja la cuenta", async () => {
      const { userId } = await registerFixtureUser();

      const uploadUrlResponse = await app.inject({
        method: "POST",
        url: "/users/me/photo/upload-url",
        headers: { "x-user-id": userId },
        payload: { contentType: "image/jpeg", contentLength: 1024 },
      });
      const { objectKey } = JSON.parse(uploadUrlResponse.body) as { objectKey: string };
      storage.__simulateUpload(objectKey, { contentType: "image/jpeg", contentLength: 1024 });
      const confirmResponse = await app.inject({
        method: "PUT",
        url: "/users/me/photo",
        headers: { "x-user-id": userId },
        payload: { objectKey },
      });
      expect(confirmResponse.statusCode).toBe(200);
      expect((await storage.headObject(objectKey)).exists).toBe(true);

      const deleteResponse = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });
      expect(deleteResponse.statusCode).toBe(204);

      expect((await storage.headObject(objectKey)).exists).toBe(false);
    });

    it("AC9 (regresión): login sobre una cuenta deleted (status seteado directo, sin pasar por esta baja) sigue devolviendo 403", async () => {
      // Caso distinto del de arriba a propósito: acá el teléfono/email NO cambian
      // (ej. una baja administrativa futura que no anonimiza) -- ejercita el chequeo
      // de `login()` (MOVO-74) que sigue sin tocarse en este ticket, no el 401 de
      // "teléfono inexistente" que deja la anonimización de esta US.
      const { userId } = await registerFixtureUser();
      await app.db.user.update({ where: { id: userId }, data: { status: "deleted" } });

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: validRegisterPayload.phone, password: "Password1" },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe("ACCOUNT_SUSPENDED");
    });

    it("permite volver a registrar una cuenta nueva con el email/teléfono ya liberados", async () => {
      const { userId } = await registerFixtureUser();

      await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });

      const reRegister = await registerFixtureUser();
      expect(reRegister.userId).not.toBe(userId);
    });

    it("con una disputa activa -> 409 ACCOUNT_HAS_ACTIVE_DISPUTES, sin ningún efecto", async () => {
      const { userId } = await registerFixtureUser();
      shipmentsFake.setResponse(userId, { hasActiveDispute: true, hasActiveShipments: false });

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("ACCOUNT_HAS_ACTIVE_DISPUTES");

      const repo = createUserRepository(app.db);
      const reloaded = await repo.findById(userId);
      expect(reloaded?.status).toBe("active");
    });

    it("con un envío activo (sin disputa) -> 409 ACCOUNT_HAS_ACTIVE_SHIPMENTS, sin ningún efecto", async () => {
      const { userId } = await registerFixtureUser();
      shipmentsFake.setResponse(userId, { hasActiveDispute: false, hasActiveShipments: true });

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("ACCOUNT_HAS_ACTIVE_SHIPMENTS");

      const repo = createUserRepository(app.db);
      const reloaded = await repo.findById(userId);
      expect(reloaded?.status).toBe("active");
    });

    it("sin password -> 400, con password incorrecta -> 401, en ambos casos sin efecto", async () => {
      const { userId } = await registerFixtureUser();

      const withoutPassword = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: {},
      });
      expect(withoutPassword.statusCode).toBe(400);

      const wrongPassword = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Incorrecta1" },
      });
      expect(wrongPassword.statusCode).toBe(401);

      const repo = createUserRepository(app.db);
      const reloaded = await repo.findById(userId);
      expect(reloaded?.status).toBe("active");
    });

    it("con el lock de baja ya tomado (otra baja del mismo usuario en curso) -> 409 ACCOUNT_DELETION_IN_PROGRESS, sin efecto", async () => {
      // Simula la ventana de una baja concurrente adquiriendo el lock por afuera, en
      // vez de confiar en que dos app.inject() en Promise.all se solapen de verdad --
      // eso resultó flaky (ninguna garantía de que el segundo llegue al SET NX antes
      // de que el primero libere el lock en el finally). Este test ejercita
      // directamente la rama "lock ya tomado" del mecanismo (MOVO-134).
      const { userId } = await registerFixtureUser();

      const acquired = await app.redis.set(`account-deletion-lock:${userId}`, "1", "EX", 30, "NX");
      expect(acquired).toBe("OK");

      const response = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("ACCOUNT_DELETION_IN_PROGRESS");

      const repo = createUserRepository(app.db);
      const reloaded = await repo.findById(userId);
      expect(reloaded?.status).toBe("active");
    });

    it("es idempotente: una cuenta ya deleted responde 204 sin volver a validar password ni envíos", async () => {
      const { userId } = await registerFixtureUser();
      await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "Password1" },
      });

      const second = await app.inject({
        method: "DELETE",
        url: "/users/me",
        headers: { "x-user-id": userId },
        payload: { password: "cualquier-cosa" },
      });
      expect(second.statusCode).toBe(204);
    });

    it("devuelve 401 AUTH_TOKEN_INVALID sin header x-user-id", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/users/me",
        payload: { password: "Password1" },
      });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  it("AC12: la Swagger generada refleja POST /users/me/password y DELETE /users/me", () => {
    const swagger = app.swagger() as { paths: Record<string, Record<string, unknown>> };
    expect(swagger.paths["/users/me/password"]?.post).toBeDefined();
    expect(swagger.paths["/users/me"]?.delete).toBeDefined();
  });
});
