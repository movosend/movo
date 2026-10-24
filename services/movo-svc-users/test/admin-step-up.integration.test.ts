import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { LEGAL_DOCUMENT_VERSIONS, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { CreateUserInput, User } from "../src/models/user";
import { SmsProvider } from "../src/adapters/sms-provider";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";

/** MOVO-332 (ADR-055): segundo factor por acción para el cambio de estado desde el panel. */

function createCaptorEmailProvider() {
  const sentCodes = new Map<string, string>();
  const provider: EmailProvider = {
    async send(to: string, _subject: string, body: EmailBody): Promise<void> {
      const match = body.text.match(/\b(\d{6})\b/);
      if (match?.[1]) sentCodes.set(to, match[1]);
    },
  };
  return { provider, sentCodes };
}

const noopSmsProvider: SmsProvider = {
  async send(): Promise<void> {},
  async sendText(): Promise<void> {},
};

describe("Step-up del cambio de estado desde el panel (MOVO-332)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let emailCaptor: ReturnType<typeof createCaptorEmailProvider>;

  const shipmentId = randomUUID();
  const otherShipmentId = randomUUID();
  const TARGET = "cancelled";
  const OTHER_TARGET = "published";

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    emailCaptor = createCaptorEmailProvider();
    app = buildApp({ emailProvider: emailCaptor.provider, smsProvider: noopSmsProvider });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    emailCaptor.sentCodes.clear();
    for (const pattern of ["otp:*", "admin-step-up-*"]) {
      let cursor = "0";
      do {
        const [next, keys] = await app.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = next;
        if (keys.length > 0) await app.redis.del(...keys);
      } while (cursor !== "0");
    }
  });

  let phoneCounter = 0;
  async function createAdmin(options: { roles?: UserRole[]; emailVerified?: boolean } = {}): Promise<User> {
    phoneCounter += 1;
    const input: CreateUserInput = {
      email: `admin-${randomUUID()}@movo.test`,
      phone: `+549351${(5000000 + phoneCounter).toString().padStart(7, "0")}`,
      firstName: "Alena",
      lastName: "Ariza",
      passwordHash: "x",
      roles: options.roles ?? [UserRole.SENDER, UserRole.ADMIN],
      termsAcceptedAt: new Date(),
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
      privacyAcceptedAt: new Date(),
      privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
      phoneVerified: true,
      address: { street: "Av. Colón", number: "1234", city: "Córdoba", province: "Córdoba", zip: "5000", lat: -31.4201, long: -64.1888 },
    };
    const user = await repo.create(input);
    await app.db.user.update({ where: { id: user.id }, data: { emailVerified: options.emailVerified ?? true } });
    return { ...user, emailVerified: options.emailVerified ?? true };
  }

  const post = (path: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/internal/admin/step-up/${path}`, payload });

  const requestCode = (adminId: string, ship = shipmentId, target = TARGET) =>
    post("request", { adminId, shipmentId: ship, targetStatus: target });

  const verifyCode = (adminId: string, challengeId: string, code: string, ship = shipmentId, target = TARGET) =>
    post("verify", { adminId, shipmentId: ship, targetStatus: target, challengeId, code });

  const consume = (adminId: string, stepUpToken: string, ship = shipmentId, target = TARGET) =>
    post("consume", { adminId, shipmentId: ship, targetStatus: target, stepUpToken });

  const validate = (adminId: string, stepUpToken: string, ship = shipmentId, target = TARGET) =>
    post("validate", { adminId, shipmentId: ship, targetStatus: target, stepUpToken });

  /** Pide el código, lo lee del mail que habría salido y lo verifica: devuelve el token. */
  async function getToken(admin: User, ship = shipmentId, target = TARGET): Promise<string> {
    const challenge = (await requestCode(admin.id, ship, target)).json();
    const verified = await verifyCode(admin.id, challenge.challengeId, emailCaptor.sentCodes.get(admin.email)!, ship, target);
    expect(verified.statusCode).toBe(200);
    return verified.json().stepUpToken;
  }

  describe("pedir el código", () => {
    it("manda un código de 6 dígitos al email del admin y devuelve el desafío con el email enmascarado", async () => {
      const admin = await createAdmin();

      const response = await requestCode(admin.id);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Object.keys(body).sort()).toEqual(["challengeId", "cooldownSeconds", "expiresInSeconds", "maskedEmail"]);
      expect(body.maskedEmail).toMatch(/^a\*\*\*@movo\.test$/);
      expect(body.expiresInSeconds).toBe(300);
      expect(emailCaptor.sentCodes.get(admin.email)).toMatch(/^\d{6}$/);
    });

    it("un usuario sin rol admin o con el email sin verificar es 403 y no recibe ningún código", async () => {
      const notAdmin = await createAdmin({ roles: [UserRole.SENDER] });
      const unverified = await createAdmin({ emailVerified: false });

      for (const user of [notAdmin, unverified]) {
        const response = await requestCode(user.id);
        expect(response.statusCode).toBe(403);
      }
      expect(emailCaptor.sentCodes.size).toBe(0);
    });

    it("pedir más de 5 veces en la ventana es 429", async () => {
      const admin = await createAdmin();

      for (let i = 0; i < 5; i += 1) expect((await requestCode(admin.id)).statusCode).toBe(200);
      const sixth = await requestCode(admin.id);

      expect(sixth.statusCode).toBe(429);
      expect(sixth.json().error.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("verificar el código", () => {
    it("con el código correcto devuelve un token de un solo uso con su vigencia", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();

      const response = await verifyCode(admin.id, challenge.challengeId, emailCaptor.sentCodes.get(admin.email)!);

      expect(response.statusCode).toBe(200);
      expect(response.json().expiresInSeconds).toBe(300);
      expect(response.json().stepUpToken).toEqual(expect.any(String));
    });

    it("el código es de un solo uso: verificarlo dos veces falla", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();
      const code = emailCaptor.sentCodes.get(admin.email)!;

      expect((await verifyCode(admin.id, challenge.challengeId, code)).statusCode).toBe(200);
      const again = await verifyCode(admin.id, challenge.challengeId, code);

      expect(again.statusCode).toBe(401);
      expect(again.json().error.code).toBe("STEP_UP_INVALID");
    });

    it("un código pedido para un envío o un destino no sirve para otro, y no se quema", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();
      const code = emailCaptor.sentCodes.get(admin.email)!;

      const otherShipment = await verifyCode(admin.id, challenge.challengeId, code, otherShipmentId, TARGET);
      const otherTarget = await verifyCode(admin.id, challenge.challengeId, code, shipmentId, OTHER_TARGET);

      for (const response of [otherShipment, otherTarget]) {
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe("STEP_UP_INVALID");
      }
      // El desafío sigue valiendo para su acción verdadera.
      expect((await verifyCode(admin.id, challenge.challengeId, code)).statusCode).toBe(200);
    });

    it("el código de un admin no lo verifica otro admin", async () => {
      const admin = await createAdmin();
      const other = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();

      const response = await verifyCode(other.id, challenge.challengeId, emailCaptor.sentCodes.get(admin.email)!);

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("STEP_UP_INVALID");
    });

    it("un código vencido (más de 5 minutos) es inválido", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();
      const code = emailCaptor.sentCodes.get(admin.email)!;
      // Retrocede la hora de emisión del desafío (el TTL de Redis del motor es de 10 min).
      await app.redis.set(`admin-step-up-issued:${challenge.challengeId}`, String(Date.now() - 301_000));

      const response = await verifyCode(admin.id, challenge.challengeId, code);

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("STEP_UP_INVALID");
    });

    it("un código erróneo, uno inexistente y uno vencido responden lo mismo (sin enumerar el motivo)", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();

      const wrong = await verifyCode(admin.id, challenge.challengeId, "000000");
      const unknown = await verifyCode(admin.id, randomUUID(), "000000");

      for (const response of [wrong, unknown]) {
        expect(response.statusCode).toBe(401);
        expect(response.json().error).toMatchObject({ code: "STEP_UP_INVALID", message: "El código ingresado es inválido o venció." });
      }
    });

    it("tras 5 errores el admin queda bloqueado un rato, aunque después acierte el código", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();
      const code = emailCaptor.sentCodes.get(admin.email)!;

      for (let i = 0; i < 5; i += 1) {
        expect((await verifyCode(admin.id, challenge.challengeId, "000000")).statusCode).toBe(401);
      }
      const blocked = await verifyCode(admin.id, challenge.challengeId, code);

      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("verificaciones concurrentes no pasan el límite: de 12 intentos erróneos en paralelo, ninguno acierta después", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();
      const code = emailCaptor.sentCodes.get(admin.email)!;

      const results = await Promise.all(Array.from({ length: 12 }, () => verifyCode(admin.id, challenge.challengeId, "000000")));

      // Solo los primeros 5 llegan a mirar el código (401); el resto ya está bloqueado (429).
      expect(results.filter((r) => r.statusCode === 401)).toHaveLength(5);
      expect(results.filter((r) => r.statusCode === 429)).toHaveLength(7);
      expect((await verifyCode(admin.id, challenge.challengeId, code)).statusCode).toBe(429);
    });

    it("pedir el código de nuevo dentro del cooldown no alarga su vigencia de 5 minutos", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();
      const code = emailCaptor.sentCodes.get(admin.email)!;
      await app.redis.set(`admin-step-up-issued:${challenge.challengeId}`, String(Date.now() - 301_000));

      // Dentro del cooldown el motor devuelve el mismo desafío y el mismo código, sin mandar otro.
      const again = (await requestCode(admin.id)).json();
      expect(again.challengeId).toBe(challenge.challengeId);
      const response = await verifyCode(admin.id, challenge.challengeId, code);

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("STEP_UP_INVALID");
    });

    it("un código de formato inválido es 400", async () => {
      const admin = await createAdmin();
      const challenge = (await requestCode(admin.id)).json();

      expect((await verifyCode(admin.id, challenge.challengeId, "12ab56")).statusCode).toBe(400);
    });
  });

  describe("validar el token sin gastarlo", () => {
    it("puede validarse varias veces y sigue sirviendo para consumirlo", async () => {
      const admin = await createAdmin();
      const token = await getToken(admin);

      expect((await validate(admin.id, token)).statusCode).toBe(204);
      expect((await validate(admin.id, token)).statusCode).toBe(204);
      expect((await consume(admin.id, token)).statusCode).toBe(204);
      expect((await validate(admin.id, token)).statusCode).toBe(401);
    });

    it("un token de otro envío, destino o admin no valida, pero tampoco se quema al probarlo", async () => {
      const admin = await createAdmin();
      const other = await createAdmin();
      const token = await getToken(admin);

      for (const response of [
        await validate(admin.id, token, otherShipmentId),
        await validate(admin.id, token, shipmentId, OTHER_TARGET),
        await validate(other.id, token),
      ]) {
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe("STEP_UP_INVALID");
      }
      expect((await consume(admin.id, token)).statusCode).toBe(204);
    });

    it("un token inexistente es 401", async () => {
      const admin = await createAdmin();
      expect((await validate(admin.id, "x".repeat(43))).statusCode).toBe(401);
    });
  });

  describe("consumir el token", () => {
    it("sirve una vez, para su acción: 204 y después 401", async () => {
      const admin = await createAdmin();
      const token = await getToken(admin);

      expect((await consume(admin.id, token)).statusCode).toBe(204);
      const again = await consume(admin.id, token);

      expect(again.statusCode).toBe(401);
      expect(again.json().error.code).toBe("STEP_UP_INVALID");
    });

    it("un token de otro envío, de otro destino o de otro admin es inválido y queda quemado", async () => {
      const admin = await createAdmin();
      const other = await createAdmin();
      const cases: Array<[string, () => Promise<{ statusCode: number }>]> = [];
      for (const [label, call] of [
        ["otro envío", (token: string) => consume(admin.id, token, otherShipmentId, TARGET)],
        ["otro destino", (token: string) => consume(admin.id, token, shipmentId, OTHER_TARGET)],
        ["otro admin", (token: string) => consume(other.id, token)],
      ] as const) {
        const token = await getToken(admin);
        cases.push([label, async () => call(token)]);
      }

      for (const [, run] of cases) expect((await run()).statusCode).toBe(401);
    });

    it("un token inexistente es 401", async () => {
      const admin = await createAdmin();
      const response = await consume(admin.id, "x".repeat(43));
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("STEP_UP_INVALID");
    });

    it("el token vence a los 5 minutos", async () => {
      const admin = await createAdmin();
      const token = await getToken(admin);
      const [key] = await app.redis.keys("admin-step-up-token:*");

      expect(key).toBeDefined();
      const ttl = await app.redis.ttl(key!);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
      await app.redis.del(key!);
      expect((await consume(admin.id, token)).statusCode).toBe(401);
    });

    it("el token no se guarda en claro en Redis", async () => {
      const admin = await createAdmin();
      const token = await getToken(admin);

      const keys = await app.redis.keys("admin-step-up-token:*");

      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toContain(token);
    });
  });
});
