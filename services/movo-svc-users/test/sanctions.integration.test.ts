import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { accountRestrictionKey, AccountSanction, LEGAL_DOCUMENT_VERSIONS, PublicProfile, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { createSessionRepository } from "../src/repositories/session-repository";
import { createSanctionsService } from "../src/modules/sanctions/sanctions.service";
import { createMockPushProvider, MockPushProvider } from "../src/adapters/mock-push-provider";
import { createNotificationsService } from "../src/modules/notifications/notifications.service";
import { CreateUserInput, User } from "../src/models/user";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";
import { SmsProvider } from "../src/adapters/sms-provider";

const PASSWORD = "Password1";
const ARGON2ID = 2;
const HOUR_MS = 60 * 60 * 1000;
const INTERNAL_NOTE = "nota-interna-secreta-no-visible";

interface SentEmail {
  to: string;
  subject: string;
  body: EmailBody;
}

const noopSmsProvider: SmsProvider = {
  async send(): Promise<void> {},
  async sendText(): Promise<void> {},
};

describe("Sanciones de cuenta (MOVO-296)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let push: MockPushProvider;
  let passwordHash: string;
  const sentEmails: SentEmail[] = [];
  const emailProvider: EmailProvider = {
    async send(to, subject, body) {
      sentEmails.push({ to, subject, body });
    },
  };
  const adminId = randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    push = createMockPushProvider();
    app = buildApp({
      emailProvider,
      smsProvider: noopSmsProvider,
      pushProvider: push,
      orphanPhotoSweepEnabled: false,
      sanctionSweepEnabled: false,
    });
    await app.ready();
    repo = createUserRepository(app.db);
    passwordHash = await hash(PASSWORD, { algorithm: ARGON2ID });
  });

  afterAll(async () => {
    await app.close();
  });

  async function clearRedis(): Promise<void> {
    for (const pattern of ["refresh:*", "panel-refresh:*", "panel-revoked-at:*", "user-revoked-at:*", "account:restriction:*"]) {
      let cursor = "0";
      do {
        const [next, keys] = await app.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = next;
        if (keys.length > 0) {
          await app.redis.del(...keys);
        }
      } while (cursor !== "0");
    }
  }

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    sentEmails.length = 0;
    push.__sentNotifications.length = 0;
    await clearRedis();
  });

  let phoneCounter = 0;
  async function createUser(options: { admin?: boolean } = {}): Promise<User> {
    phoneCounter += 1;
    const input: CreateUserInput = {
      email: `user-${randomUUID()}@movo.test`,
      phone: `+549351${(6000000 + phoneCounter).toString().padStart(7, "0")}`,
      firstName: "Lucas",
      lastName: "Dalmagro",
      passwordHash,
      roles: options.admin ? [UserRole.SENDER, UserRole.ADMIN] : [UserRole.SENDER, UserRole.CARRIER],
      termsAcceptedAt: new Date(),
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
      privacyAcceptedAt: new Date(),
      privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
      phoneVerified: true,
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
    const user = await repo.create(input);
    await app.db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    await app.db.pushToken.create({
      data: { userId: user.id, expoPushToken: `ExponentPushToken[${user.id}]`, deviceId: "device-1", platform: "ios" },
    });
    return user;
  }

  function sanction(userId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/internal/users/${userId}/sanctions`,
      headers: { "x-user-id": adminId },
      payload,
    });
  }

  function lift(userId: string, sanctionId: string, reason = "Revisado, se levanta") {
    return app.inject({
      method: "POST",
      url: `/internal/users/${userId}/sanctions/${sanctionId}/lift`,
      headers: { "x-user-id": adminId },
      payload: { reason },
    });
  }

  async function history(userId: string): Promise<AccountSanction[]> {
    const response = await app.inject({ method: "GET", url: `/internal/users/${userId}/sanctions` });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body) as AccountSanction[];
  }

  async function login(user: User) {
    return app.inject({ method: "POST", url: "/auth/login", payload: { phone: user.phone, password: PASSWORD } });
  }

  function suspendPayload(endsAt?: Date) {
    return {
      type: "suspension",
      reason: "Conducta inapropiada",
      internalNote: INTERNAL_NOTE,
      ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
    };
  }

  describe("modelo y endpoints internos", () => {
    it("suspender con fin deja la fila del historial, la caché en User y la marca con el TTL del fin", async () => {
      const user = await createUser();
      const endsAt = new Date(Date.now() + 2 * HOUR_MS);

      const response = await sanction(user.id, suspendPayload(endsAt));

      expect(response.statusCode).toBe(201);
      const created = JSON.parse(response.body) as AccountSanction;
      expect(created).toMatchObject({
        userId: user.id,
        type: "suspension",
        reason: "Conducta inapropiada",
        internalNote: INTERNAL_NOTE,
        endsAt: endsAt.toISOString(),
        appliedBy: adminId,
        liftedAt: null,
        closedCause: null,
      });

      const stored = await app.db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.status).toBe("suspended");
      expect(stored.bannedUntil?.toISOString()).toBe(endsAt.toISOString());

      const key = accountRestrictionKey(user.id);
      expect(await app.redis.get(key)).toBe("suspended");
      const ttl = await app.redis.pttl(key);
      expect(ttl).toBeGreaterThan(2 * HOUR_MS - 60_000);
      expect(ttl).toBeLessThanOrEqual(2 * HOUR_MS);
    });

    it("suspensión indefinida: marca sin TTL y sin fin", async () => {
      const user = await createUser();

      const response = await sanction(user.id, suspendPayload());

      expect(response.statusCode).toBe(201);
      expect((JSON.parse(response.body) as AccountSanction).endsAt).toBeNull();
      expect(await app.redis.get(accountRestrictionKey(user.id))).toBe("suspended");
      expect(await app.redis.pttl(accountRestrictionKey(user.id))).toBe(-1);
    });

    it("inhabilitar: status banned, marca disabled sin TTL y sesiones de la app y del panel revocadas", async () => {
      const user = await createUser();
      const session = await login(user);
      expect(session.statusCode).toBe(200);
      const { accessToken } = JSON.parse(session.body) as { accessToken: string };
      expect(accessToken).toBeTruthy();
      expect(await app.redis.keys(`refresh:${user.id}:*`)).toHaveLength(1);

      const response = await sanction(user.id, { type: "disable", reason: "Fraude comprobado", internalNote: INTERNAL_NOTE });

      expect(response.statusCode).toBe(201);
      expect((await app.db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("banned");
      expect(await app.redis.get(accountRestrictionKey(user.id))).toBe("disabled");
      expect(await app.redis.pttl(accountRestrictionKey(user.id))).toBe(-1);
      expect(await app.redis.keys(`refresh:${user.id}:*`)).toHaveLength(0);
      expect(await app.redis.exists(`panel-revoked-at:${user.id}`)).toBe(1);
    });

    it("suspender a alguien ya suspendido reemplaza la sanción vigente y cierra la anterior", async () => {
      const user = await createUser();
      const first = JSON.parse((await sanction(user.id, suspendPayload(new Date(Date.now() + HOUR_MS)))).body) as AccountSanction;

      const second = await sanction(user.id, suspendPayload(new Date(Date.now() + 5 * HOUR_MS)));

      expect(second.statusCode).toBe(201);
      const rows = await history(user.id);
      expect(rows).toHaveLength(2);
      const closed = rows.find((row) => row.id === first.id);
      expect(closed).toMatchObject({ closedCause: "replaced", liftedBy: adminId });
      expect(closed?.liftedAt).not.toBeNull();
      expect(rows.filter((row) => row.liftedAt === null)).toHaveLength(1);
      const ttl = await app.redis.pttl(accountRestrictionKey(user.id));
      expect(ttl).toBeGreaterThan(4 * HOUR_MS);
    });

    it("inhabilitar a un suspendido escala la sanción; inhabilitar a un inhabilitado es 409", async () => {
      const user = await createUser();
      const suspension = JSON.parse((await sanction(user.id, suspendPayload())).body) as AccountSanction;

      const disabled = await sanction(user.id, { type: "disable", reason: "Reincidencia" });

      expect(disabled.statusCode).toBe(201);
      const rows = await history(user.id);
      expect(rows.find((row) => row.id === suspension.id)?.closedCause).toBe("escalated");
      expect(await app.redis.get(accountRestrictionKey(user.id))).toBe("disabled");

      const again = await sanction(user.id, { type: "disable", reason: "Otra vez" });
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.body).error.code).toBe("ACCOUNT_ALREADY_DISABLED");
    });

    it("levantar cierra la sanción con motivo, deja la cuenta active y borra la marca", async () => {
      const user = await createUser();
      const created = JSON.parse((await sanction(user.id, suspendPayload())).body) as AccountSanction;

      const response = await lift(user.id, created.id);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        closedCause: "lifted",
        liftedBy: adminId,
        liftReason: "Revisado, se levanta",
      });
      const stored = await app.db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.status).toBe("active");
      expect(stored.bannedUntil).toBeNull();
      expect(await app.redis.exists(accountRestrictionKey(user.id))).toBe(0);

      const again = await lift(user.id, created.id);
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.body).error.code).toBe("SANCTION_ALREADY_CLOSED");
    });

    it("levantar una sanción inexistente o de otro usuario es 404", async () => {
      const user = await createUser();
      const other = await createUser();
      const created = JSON.parse((await sanction(user.id, suspendPayload())).body) as AccountSanction;

      expect((await lift(user.id, randomUUID())).statusCode).toBe(404);
      const wrongUser = await lift(other.id, created.id);
      expect(wrongUser.statusCode).toBe(404);
      expect(JSON.parse(wrongUser.body).error.code).toBe("SANCTION_NOT_FOUND");
    });

    it("valida el cuerpo: motivo obligatorio, fin futuro, la inhabilitación no lleva fin", async () => {
      const user = await createUser();

      expect((await sanction(user.id, { type: "suspension", reason: "   " })).statusCode).toBe(400);
      expect((await sanction(user.id, suspendPayload(new Date(Date.now() - HOUR_MS)))).statusCode).toBe(400);
      expect(
        (await sanction(user.id, { type: "disable", reason: "x", endsAt: new Date(Date.now() + HOUR_MS).toISOString() }))
          .statusCode
      ).toBe(400);
      expect((await sanction(randomUUID(), { type: "disable", reason: "x" })).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/internal/users/${user.id}/sanctions`,
            payload: { type: "disable", reason: "x" },
          })
        ).statusCode
      ).toBe(401);
      expect(await history(user.id)).toHaveLength(0);
    });

    it("el historial es append-only: el trigger rechaza cambiar los campos de la sanción y borrar el cierre", async () => {
      const user = await createUser();
      const created = JSON.parse((await sanction(user.id, suspendPayload())).body) as AccountSanction;

      await expect(
        app.db.accountSanction.update({ where: { id: created.id }, data: { reason: "reescrito" } })
      ).rejects.toThrow();

      await lift(user.id, created.id);
      await expect(
        app.db.accountSanction.update({ where: { id: created.id }, data: { liftReason: "otro" } })
      ).rejects.toThrow();
    });

    it("un admin: se le cortan las sesiones de panel y no se puede sancionar al último admin elegible", async () => {
      const lastAdmin = await createUser({ admin: true });

      const blocked = await sanction(lastAdmin.id, suspendPayload());
      expect(blocked.statusCode).toBe(409);
      expect(JSON.parse(blocked.body).error.code).toBe("ADMIN_LAST_ADMIN");
      expect((await app.db.user.findUniqueOrThrow({ where: { id: lastAdmin.id } })).status).toBe("active");

      const secondAdmin = await createUser({ admin: true });
      const allowed = await sanction(lastAdmin.id, suspendPayload());
      expect(allowed.statusCode).toBe(201);
      expect(await app.redis.exists(`panel-revoked-at:${lastAdmin.id}`)).toBe(1);

      // Con uno solo elegible, el que queda no puede sancionarse.
      const stillBlocked = await sanction(secondAdmin.id, { type: "disable", reason: "x" });
      expect(stillBlocked.statusCode).toBe(409);
    });
  });

  describe("login, refresh y reset", () => {
    it("un suspendido puede loguearse y refrescar; un inhabilitado no", async () => {
      const suspended = await createUser();
      await sanction(suspended.id, suspendPayload(new Date(Date.now() + HOUR_MS)));

      const suspendedLogin = await login(suspended);
      expect(suspendedLogin.statusCode).toBe(200);
      const { refreshToken } = JSON.parse(suspendedLogin.body) as { refreshToken: string };
      const refreshed = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
      expect(refreshed.statusCode).toBe(200);

      const disabled = await createUser();
      const session = JSON.parse((await login(disabled)).body) as { refreshToken: string };
      await sanction(disabled.id, { type: "disable", reason: "Fraude" });

      const disabledLogin = await login(disabled);
      expect(disabledLogin.statusCode).toBe(403);
      expect(JSON.parse(disabledLogin.body).error.code).toBe("ACCOUNT_DISABLED");
      const disabledRefresh = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: session.refreshToken },
      });
      expect(disabledRefresh.statusCode).toBeGreaterThanOrEqual(401);
    });

    it("una suspensión vencida que el barrido no cerró se trata como active en cualquier lectura", async () => {
      const user = await createUser();
      await app.db.user.update({
        where: { id: user.id },
        data: { status: "suspended", bannedUntil: new Date(Date.now() - 1000) },
      });

      const read = await repo.findById(user.id);

      expect(read?.status).toBe("active");
      expect(read?.bannedUntil).toBeNull();
      expect((await login(user)).statusCode).toBe(200);
    });
  });

  describe("barrido", () => {
    function buildService() {
      return createSanctionsService({
        db: app.db,
        redis: app.redis,
        sessionRepository: createSessionRepository(app.redis),
        notifications: createNotificationsService(app.db, push, app.log),
        emailProvider,
        logger: app.log,
      });
    }

    it("levanta la suspensión vencida: active, historial cerrado con el fin y aviso al usuario", async () => {
      const user = await createUser();
      const created = JSON.parse((await sanction(user.id, suspendPayload(new Date(Date.now() + HOUR_MS)))).body) as AccountSanction;
      // Se adelanta el reloj de la sanción: el fin pasa al pasado sin tocar el resto del historial.
      const past = new Date(Date.now() - 1000);
      await app.db.$executeRawUnsafe(
        `ALTER TABLE users.account_sanctions DISABLE TRIGGER account_sanctions_guard`
      );
      await app.db.$executeRawUnsafe(`UPDATE users.account_sanctions SET ends_at = $1 WHERE id = $2::uuid`, past, created.id);
      await app.db.$executeRawUnsafe(`ALTER TABLE users.account_sanctions ENABLE TRIGGER account_sanctions_guard`);
      await app.db.user.update({ where: { id: user.id }, data: { bannedUntil: past } });
      push.__sentNotifications.length = 0;
      sentEmails.length = 0;

      const expired = await buildService().expireDueSuspensions();

      expect(expired).toBe(1);
      const stored = await app.db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.status).toBe("active");
      expect(stored.bannedUntil).toBeNull();
      const [row] = await history(user.id);
      expect(row).toMatchObject({ closedCause: "expired", liftedBy: null });
      expect(row?.liftedAt).toBe(past.toISOString());
      expect(await app.redis.exists(accountRestrictionKey(user.id))).toBe(0);
      expect(push.__sentNotifications.map((n) => n.title)).toEqual(["Terminó la suspensión de tu cuenta"]);
      expect(sentEmails.map((m) => m.subject)).toEqual(["Terminó la suspensión de tu cuenta de Movo"]);

      // Idempotente: una segunda pasada no vuelve a avisar.
      expect(await buildService().expireDueSuspensions()).toBe(0);
      expect(push.__sentNotifications).toHaveLength(1);
    });

    it("no toca las suspensiones vigentes", async () => {
      const user = await createUser();
      await sanction(user.id, suspendPayload(new Date(Date.now() + HOUR_MS)));

      expect(await buildService().expireDueSuspensions()).toBe(0);

      expect((await app.db.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe("suspended");
    });

    it("reescribe las marcas de las sanciones vigentes con su TTL si Redis perdió datos", async () => {
      const suspended = await createUser();
      const disabled = await createUser();
      const lifted = await createUser();
      await sanction(suspended.id, suspendPayload(new Date(Date.now() + 3 * HOUR_MS)));
      await sanction(disabled.id, { type: "disable", reason: "Fraude" });
      const liftedSanction = JSON.parse((await sanction(lifted.id, suspendPayload())).body) as AccountSanction;
      await lift(lifted.id, liftedSanction.id);
      await clearRedis();

      const written = await buildService().rewriteMarks();

      expect(written).toBe(2);
      expect(await app.redis.get(accountRestrictionKey(suspended.id))).toBe("suspended");
      const ttl = await app.redis.pttl(accountRestrictionKey(suspended.id));
      expect(ttl).toBeGreaterThan(3 * HOUR_MS - 60_000);
      expect(ttl).toBeLessThanOrEqual(3 * HOUR_MS);
      expect(await app.redis.get(accountRestrictionKey(disabled.id))).toBe("disabled");
      expect(await app.redis.pttl(accountRestrictionKey(disabled.id))).toBe(-1);
      expect(await app.redis.exists(accountRestrictionKey(lifted.id))).toBe(0);
    });

    it("al arrancar el servicio se reescriben las marcas", async () => {
      const user = await createUser();
      await sanction(user.id, suspendPayload(new Date(Date.now() + 4 * HOUR_MS)));
      await clearRedis();
      expect(await app.redis.exists(accountRestrictionKey(user.id))).toBe(0);

      const restarted = buildApp({
        emailProvider,
        smsProvider: noopSmsProvider,
        pushProvider: push,
        orphanPhotoSweepEnabled: false,
        sanctionSweepEnabled: true,
      });
      try {
        await restarted.ready();

        expect(await app.redis.get(accountRestrictionKey(user.id))).toBe("suspended");
        const ttl = await app.redis.pttl(accountRestrictionKey(user.id));
        expect(ttl).toBeGreaterThan(4 * HOUR_MS - 60_000);
        expect(ttl).toBeLessThanOrEqual(4 * HOUR_MS);
      } finally {
        await restarted.close();
      }
    });
  });

  describe("avisos al usuario", () => {
    it("al suspender avisa por push y email con el motivo y el plazo, nunca con la nota interna", async () => {
      const user = await createUser();
      const endsAt = new Date(Date.now() + 48 * HOUR_MS);

      await sanction(user.id, suspendPayload(endsAt));

      expect(push.__sentNotifications).toHaveLength(1);
      expect(push.__sentNotifications[0]?.title).toBe("Suspendimos tu cuenta");
      expect(push.__sentNotifications[0]?.body).toContain("Conducta inapropiada");
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]?.to).toBe(user.email);
      expect(sentEmails[0]?.body.text).toContain("Conducta inapropiada");
      expect(sentEmails[0]?.body.text).toMatch(/hasta el \d{2}\/\d{2}\/\d{4}/);
      const everything = JSON.stringify([push.__sentNotifications, sentEmails]);
      expect(everything).not.toContain(INTERNAL_NOTE);
    });

    it("al inhabilitar y al levantar también avisa", async () => {
      const user = await createUser();
      const created = JSON.parse((await sanction(user.id, { type: "disable", reason: "Fraude", internalNote: INTERNAL_NOTE })).body) as AccountSanction;

      expect(push.__sentNotifications.map((n) => n.title)).toEqual(["Inhabilitamos tu cuenta"]);
      expect(push.__sentNotifications[0]?.body).toContain("Fraude");

      await lift(user.id, created.id);

      expect(push.__sentNotifications.map((n) => n.title)).toEqual([
        "Inhabilitamos tu cuenta",
        "Levantamos la restricción de tu cuenta",
      ]);
      expect(sentEmails.map((m) => m.subject)).toEqual([
        "Inhabilitamos tu cuenta de Movo",
        "Levantamos la restricción de tu cuenta de Movo",
      ]);
      expect(JSON.stringify([push.__sentNotifications, sentEmails])).not.toContain(INTERNAL_NOTE);
    });
  });

  describe("perfil público", () => {
    it("muestra el estado de la cuenta y nunca el motivo ni la nota interna", async () => {
      const viewer = await createUser();
      const target = await createUser();
      const headers = { "x-user-id": viewer.id };
      const profile = async () =>
        app.inject({ method: "GET", url: `/users/${target.id}`, headers });

      expect(JSON.parse((await profile()).body).accountStatus).toBe("active");

      const created = JSON.parse((await sanction(target.id, suspendPayload(new Date(Date.now() + HOUR_MS)))).body) as AccountSanction;
      let response = await profile();
      expect(response.statusCode).toBe(200);
      expect((JSON.parse(response.body) as PublicProfile).accountStatus).toBe("suspended");
      expect(response.body).not.toContain("Conducta inapropiada");
      expect(response.body).not.toContain(INTERNAL_NOTE);

      await sanction(target.id, { type: "disable", reason: "Motivo-secreto-de-inhabilitacion", internalNote: INTERNAL_NOTE });
      response = await profile();
      expect((JSON.parse(response.body) as PublicProfile).accountStatus).toBe("disabled");
      expect(response.body).not.toContain("Motivo-secreto-de-inhabilitacion");
      expect(response.body).not.toContain(INTERNAL_NOTE);

      const search = await app.inject({ method: "GET", url: `/users/search?q=Lucas`, headers });
      expect(search.body).not.toContain(INTERNAL_NOTE);
      expect(created.id).toBeTruthy();
    });
  });
});
