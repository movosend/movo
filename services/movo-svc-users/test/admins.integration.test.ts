import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { LEGAL_DOCUMENT_VERSIONS, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { createSessionRepository } from "../src/repositories/session-repository";
import {
  createAdminRolesService,
  ensureNotLastEligibleAdmin,
  AdminRolesLogger,
} from "../src/modules/admins/admin-roles.service";
import { runAdminRoleCli } from "../src/scripts/admin-role";
import { CreateUserInput, User } from "../src/models/user";
import { SmsProvider } from "../src/adapters/sms-provider";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";

const PASSWORD = "Password1";
const ARGON2ID = 2;

interface SentEmail {
  to: string;
  subject: string;
  body: EmailBody;
}

/** Guarda todo lo que se mandó: los OTP del login del panel y los avisos de rol. */
function createCaptorEmailProvider() {
  const sent: SentEmail[] = [];
  let failNext = false;
  const provider: EmailProvider = {
    async send(to: string, subject: string, body: EmailBody): Promise<void> {
      if (failNext) {
        failNext = false;
        throw new Error("proveedor caído");
      }
      sent.push({ to, subject, body });
    },
  };
  return {
    provider,
    sent,
    failNextSend: () => {
      failNext = true;
    },
    otpFor: (to: string) => {
      const mail = [...sent].reverse().find((m) => m.to === to && /\b\d{6}\b/.test(m.body.text));
      return mail?.body.text.match(/\b(\d{6})\b/)?.[1];
    },
    adminNoticesFor: (to: string) => sent.filter((m) => m.to === to && m.subject.includes("panel")),
  };
}

const noopSmsProvider: SmsProvider = {
  async send(): Promise<void> {},
  async sendText(): Promise<void> {},
};

function createSpyLogger() {
  const entries: { level: string; obj: Record<string, unknown> }[] = [];
  const write = (level: string) => (obj: Record<string, unknown>) => {
    entries.push({ level, obj });
  };
  const logger: AdminRolesLogger = { info: write("info"), warn: write("warn"), error: write("error") };
  return { logger, entries };
}

describe("Alta y baja del rol admin (MOVO-290)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let emailCaptor: ReturnType<typeof createCaptorEmailProvider>;
  let passwordHash: string;
  const requesterId = randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    emailCaptor = createCaptorEmailProvider();
    app = buildApp({ emailProvider: emailCaptor.provider, smsProvider: noopSmsProvider });
    await app.ready();
    repo = createUserRepository(app.db);
    passwordHash = await hash(PASSWORD, { algorithm: ARGON2ID });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    emailCaptor.sent.length = 0;
    for (const pattern of [
      "otp:*",
      "refresh:*",
      "panel-refresh:*",
      "panel-revoked-at:*",
      "user-revoked-at:*",
      "admin-login-attempts:*",
    ]) {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await app.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await app.redis.del(...keys);
        }
      } while (cursor !== "0");
    }
  });

  let phoneCounter = 0;
  function nextPhone(): string {
    phoneCounter += 1;
    return `+549351${(5000000 + phoneCounter).toString().padStart(7, "0")}`;
  }

  async function createUser(
    options: { admin?: boolean; emailVerified?: boolean; status?: "active" | "banned" | "deleted" } = {}
  ): Promise<User> {
    const input: CreateUserInput = {
      email: `user-${randomUUID()}@movo.test`,
      phone: nextPhone(),
      firstName: "Lucas",
      lastName: "Dalmagro",
      passwordHash,
      roles: options.admin ? [UserRole.SENDER, UserRole.CARRIER, UserRole.ADMIN] : [UserRole.SENDER, UserRole.CARRIER],
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
    await app.db.user.update({
      where: { id: user.id },
      data: { emailVerified: options.emailVerified ?? true, status: options.status ?? "active" },
    });
    return user;
  }

  async function isAdmin(userId: string): Promise<boolean> {
    const user = await repo.findById(userId);
    return user?.roles.includes(UserRole.ADMIN) ?? false;
  }

  function grant(email: string, headers: Record<string, string> = { "x-user-id": requesterId }) {
    return app.inject({ method: "POST", url: "/internal/admins", headers, payload: { email } });
  }

  function revoke(userId: string) {
    return app.inject({ method: "DELETE", url: `/internal/admins/${userId}`, headers: { "x-user-id": requesterId } });
  }

  async function openPanelSession(user: User): Promise<{ refreshToken: string }> {
    const login = await app.inject({
      method: "POST",
      url: "/auth/admin/login",
      payload: { email: user.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const { challengeId } = JSON.parse(login.body) as { challengeId: string };
    const code = emailCaptor.otpFor(user.email);
    const verify = await app.inject({ method: "POST", url: "/auth/admin/verify", payload: { challengeId, code } });
    expect(verify.statusCode).toBe(200);
    return JSON.parse(verify.body) as { refreshToken: string };
  }

  async function openAppSession(user: User): Promise<{ refreshToken: string }> {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { phone: user.phone, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return JSON.parse(login.body) as { refreshToken: string };
  }

  describe("GET /internal/admins", () => {
    it("lista solo a los admins, del otorgamiento más viejo al más nuevo", async () => {
      const first = await createUser({ admin: true });
      const second = await createUser();
      await createUser();
      expect((await grant(second.email)).statusCode).toBe(201);

      const response = await app.inject({ method: "GET", url: "/internal/admins" });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { id: string; fullName: string; email: string; status: string; grantedAt: string }[];
      expect(body.map((admin) => admin.id)).toEqual([first.id, second.id]);
      expect(body[0]).toEqual({
        id: first.id,
        fullName: "Lucas Dalmagro",
        email: first.email,
        status: "active",
        grantedAt: expect.any(String),
      });
    });

    it("deja afuera las cuentas dadas de baja y muestra el status (Comentario 3)", async () => {
      const activeAdmin = await createUser({ admin: true, status: "active" });
      const bannedAdmin = await createUser({ admin: true, status: "banned" });
      const deletedAdmin = await createUser({ admin: true, status: "deleted" });

      const response = await app.inject({ method: "GET", url: "/internal/admins" });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { id: string; status: string }[];
      expect(body.map((admin) => admin.id)).toEqual([activeAdmin.id, bannedAdmin.id]);
      expect(body.find((a) => a.id === activeAdmin.id)?.status).toBe("active");
      expect(body.find((a) => a.id === bannedAdmin.id)?.status).toBe("banned");
      expect(body.some((a) => a.id === deletedAdmin.id)).toBe(false);
    });
  });

  describe("POST /internal/admins (AC1, AC2, AC5)", () => {
    it("otorga el rol y avisa por email", async () => {
      const user = await createUser();

      const response = await grant(user.email.toUpperCase());

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toMatchObject({ id: user.id, email: user.email, status: "active" });
      expect(await isAdmin(user.id)).toBe(true);
      expect(emailCaptor.adminNoticesFor(user.email)).toHaveLength(1);
    });

    it("es idempotente: otorgar a quien ya es admin responde 200 y no reenvía el aviso", async () => {
      const user = await createUser();
      expect((await grant(user.email)).statusCode).toBe(201);

      const again = await grant(user.email);

      expect(again.statusCode).toBe(200);
      expect(emailCaptor.adminNoticesFor(user.email)).toHaveLength(1);
    });

    it("rechaza a un usuario con el email sin verificar", async () => {
      const user = await createUser({ emailVerified: false });

      const response = await grant(user.email);

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("ADMIN_GRANT_EMAIL_NOT_VERIFIED");
      expect(await isAdmin(user.id)).toBe(false);
      expect(emailCaptor.adminNoticesFor(user.email)).toHaveLength(0);
    });

    it("es idempotente también con un admin suspendido: 200, sin 422 (review de PR #247)", async () => {
      const suspended = await createUser({ admin: true, status: "banned" });

      const response = await grant(suspended.email);

      expect(response.statusCode).toBe(200);
      expect(emailCaptor.adminNoticesFor(suspended.email)).toHaveLength(0);
    });

    it("rechaza una cuenta que no está activa", async () => {
      const user = await createUser({ status: "banned" });

      const response = await grant(user.email);

      expect(response.statusCode).toBe(422);
      expect(JSON.parse(response.body).error.code).toBe("ADMIN_GRANT_ACCOUNT_NOT_ACTIVE");
      expect(await isAdmin(user.id)).toBe(false);
    });

    it("responde 404 si no existe un usuario con ese email", async () => {
      const response = await grant("nadie@movo.test");

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("USER_NOT_FOUND");
    });

    it("exige saber quién pide la operación (x-user-id)", async () => {
      const user = await createUser();

      const response = await grant(user.email, {});

      expect(response.statusCode).toBe(401);
      expect(await isAdmin(user.id)).toBe(false);
    });

    it("un fallo del proveedor de email no revierte el otorgamiento", async () => {
      const user = await createUser();
      emailCaptor.failNextSend();

      const response = await grant(user.email);

      expect(response.statusCode).toBe(201);
      expect(await isAdmin(user.id)).toBe(true);
    });
  });

  describe("DELETE /internal/admins/:userId (AC3, AC4)", () => {
    it("revocar al último admin responde 409 y el rol queda intacto", async () => {
      const onlyAdmin = await createUser({ admin: true });

      const response = await revoke(onlyAdmin.id);

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe("ADMIN_LAST_ADMIN");
      expect(await isAdmin(onlyAdmin.id)).toBe(true);
    });

    it("un admin suspendido no cuenta como admin restante", async () => {
      const target = await createUser({ admin: true });
      await createUser({ admin: true, status: "banned" });

      const response = await revoke(target.id);

      expect(response.statusCode).toBe(409);
      expect(await isAdmin(target.id)).toBe(true);
    });

    it("revocar el rol corta las sesiones de panel y no las de la app", async () => {
      const target = await createUser({ admin: true });
      await createUser({ admin: true });
      const panel = await openPanelSession(target);
      const appSession = await openAppSession(target);

      const response = await revoke(target.id);

      expect(response.statusCode).toBe(204);
      expect(await isAdmin(target.id)).toBe(false);
      expect(await app.redis.exists(`panel-revoked-at:${target.id}`)).toBe(1);

      const panelRefresh = await app.inject({
        method: "POST",
        url: "/auth/admin/refresh",
        payload: { refreshToken: panel.refreshToken },
      });
      expect(panelRefresh.statusCode).toBe(401);

      const appRefresh = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: appSession.refreshToken },
      });
      expect(appRefresh.statusCode).toBe(200);
    });

    it("responde 404 si el usuario no es admin", async () => {
      await createUser({ admin: true });
      const user = await createUser();

      const response = await revoke(user.id);

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("ADMIN_NOT_FOUND");
    });

    it("evita escribir panel-revoked-at para UUIDs inexistentes (Comentario 5)", async () => {
      await createUser({ admin: true });
      const nonExistentId = randomUUID();

      const response = await revoke(nonExistentId);

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe("ADMIN_NOT_FOUND");
      const revokedAt = await app.redis.get(`panel-revoked-at:${nonExistentId}`);
      expect(revokedAt).toBeNull();
    });

    it("si falla Redis al revocar a alguien que no es admin, responde 404 y no 500 (Comentario 5)", async () => {
      await createUser({ admin: true });
      const user = await createUser();
      const faultySessionRepo = {
        revokePanelSessionsForUser: async () => {
          throw new Error("Redis connection dropped");
        },
      };
      const { logger } = createSpyLogger();
      const service = createAdminRolesService({
        db: app.db,
        sessionRepository: faultySessionRepo,
        emailProvider: emailCaptor.provider,
        logger,
      });

      await expect(service.revokeAdmin(user.id, requesterId)).rejects.toThrowError(
        expect.objectContaining({ statusCode: 404, code: "ADMIN_NOT_FOUND" })
      );
    });

    it("dos revocaciones simultáneas de los dos últimos admins: una pasa y la otra da 409", async () => {
      const first = await createUser({ admin: true });
      const second = await createUser({ admin: true });

      const responses = await Promise.all([revoke(first.id), revoke(second.id)]);

      expect(responses.map((r) => r.statusCode).sort()).toEqual([204, 409]);
      const remaining = (await isAdmin(first.id) ? 1 : 0) + (await isAdmin(second.id) ? 1 : 0);
      expect(remaining).toBe(1);
    });
  });

  describe("Invariante de nunca cero admins en deleteAccount (Comentarios 1 y 2)", () => {
    it("la baja de cuenta (deleteAccount) rechaza con 409 si el usuario es el último admin elegible", async () => {
      const admin = await createUser({ admin: true });
      await expect(
        app.db.$transaction((tx) => ensureNotLastEligibleAdmin(tx, admin.id, "No se puede dar de baja al último admin."))
      ).rejects.toThrowError(expect.objectContaining({ statusCode: 409, code: "ADMIN_LAST_ADMIN" }));
    });

    it("permite la baja de cuenta si queda otro admin elegible", async () => {
      const first = await createUser({ admin: true });
      await createUser({ admin: true });
      await expect(
        app.db.$transaction((tx) => ensureNotLastEligibleAdmin(tx, first.id, "No se puede dar de baja al último admin."))
      ).resolves.toEqual({ isAdmin: true });
    });

    it("no bloquea si el usuario no es admin", async () => {
      const normalUser = await createUser();
      await expect(
        app.db.$transaction((tx) => ensureNotLastEligibleAdmin(tx, normalUser.id, "No se puede dar de baja al último admin."))
      ).resolves.toEqual({ isAdmin: false });
    });
  });

  describe("registro de quién pidió la operación (AC6)", () => {
    it("otorgar y revocar loguean al solicitante", async () => {
      const { logger, entries } = createSpyLogger();
      const service = createAdminRolesService({
        db: app.db,
        sessionRepository: createSessionRepository(app.redis),
        emailProvider: emailCaptor.provider,
        logger,
      });
      const target = await createUser();
      await createUser({ admin: true });

      await service.grantAdmin(target.email, requesterId);
      await service.revokeAdmin(target.id, requesterId);

      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            obj: expect.objectContaining({ action: "admin_role_granted", targetUserId: target.id, requestedBy: requesterId }),
          }),
          expect.objectContaining({
            obj: expect.objectContaining({ action: "admin_role_revoked", targetUserId: target.id, requestedBy: requesterId }),
          }),
        ])
      );
    });
  });

  describe("script de CLI (AC1, AC3)", () => {
    function cliDeps() {
      return {
        db: app.db,
        sessionRepository: createSessionRepository(app.redis),
        emailProvider: emailCaptor.provider,
        logger: createSpyLogger().logger,
      };
    }

    function captureOutput() {
      const lines: string[] = [];
      return { lines, output: { out: (m: string) => lines.push(m), err: (m: string) => lines.push(m) } };
    }

    it("grant crea el primer admin y repetirlo no falla", async () => {
      const user = await createUser();
      const { output } = captureOutput();

      expect(await runAdminRoleCli(["grant", user.email], cliDeps(), output)).toBe(0);
      expect(await runAdminRoleCli(["grant", user.email], cliDeps(), output)).toBe(0);

      expect(await isAdmin(user.id)).toBe(true);
      expect(emailCaptor.adminNoticesFor(user.email)).toHaveLength(1);
    });

    it("grant rechaza un email sin verificar", async () => {
      const user = await createUser({ emailVerified: false });
      const { lines, output } = captureOutput();

      expect(await runAdminRoleCli(["grant", user.email], cliDeps(), output)).toBe(1);
      expect(lines.join("\n")).toContain("ADMIN_GRANT_EMAIL_NOT_VERIFIED");
      expect(await isAdmin(user.id)).toBe(false);
    });

    it("revoke por email, pero nunca al último admin", async () => {
      const first = await createUser({ admin: true });
      const second = await createUser({ admin: true });
      const { lines, output } = captureOutput();

      expect(await runAdminRoleCli(["revoke", first.email], cliDeps(), output)).toBe(0);
      expect(await runAdminRoleCli(["revoke", second.email], cliDeps(), output)).toBe(1);

      expect(lines.join("\n")).toContain("ADMIN_LAST_ADMIN");
      expect(await isAdmin(first.id)).toBe(false);
      expect(await isAdmin(second.id)).toBe(true);
    });

    it("sin comando o sin email muestra el uso y sale con 2", async () => {
      const { lines, output } = captureOutput();

      expect(await runAdminRoleCli([], cliDeps(), output)).toBe(2);
      expect(await runAdminRoleCli(["promote", "a@movo.test"], cliDeps(), output)).toBe(2);
      expect(lines[0]).toContain("admin:grant");
    });
  });

  it("los endpoints no aparecen en la Swagger pública", async () => {
    const response = await app.inject({ method: "GET", url: "/docs/json" });

    expect(Object.keys(JSON.parse(response.body).paths)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/internal/admins")])
    );
  });
});
