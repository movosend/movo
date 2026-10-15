import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { LEGAL_DOCUMENT_VERSIONS, PANEL_SESSION_TTL_SECONDS, UserRole, verifyAccessToken } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { createSessionRepository } from "../src/repositories/session-repository";
import { createAdminSessionService } from "../src/modules/auth/admin-session.service";
import { createOtpRepository } from "../src/repositories/otp-repository";
import { createOtpService } from "../src/services/otp-service";
import { CreateUserInput, User } from "../src/models/user";
import { SmsProvider } from "../src/adapters/sms-provider";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";

const PASSWORD = "Password1";
const ARGON2ID = 2;

/** El código nunca sale por HTTP: los tests lo leen del mail que habría salido. */
function createCaptorEmailProvider() {
  const sentCodes = new Map<string, string>();
  const provider: EmailProvider = {
    async send(to: string, _subject: string, body: EmailBody): Promise<void> {
      const match = body.text.match(/\b(\d{6})\b/);
      if (match?.[1]) {
        sentCodes.set(to, match[1]);
      }
    },
  };
  return { provider, sentCodes };
}

const noopSmsProvider: SmsProvider = {
  async send(): Promise<void> {},
  async sendText(): Promise<void> {},
};

interface PanelSessionBody {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionExpiresAt: string;
  roles: string[];
}

describe("Sesión de panel (MOVO-287)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let emailCaptor: ReturnType<typeof createCaptorEmailProvider>;
  let passwordHash: string;

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
    emailCaptor.sentCodes.clear();
    for (const pattern of [
      "otp:*",
      "refresh:*",
      "panel-refresh:*",
      "panel-rotation:*",
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

  afterEach(() => {
    vi.useRealTimers();
  });

  let phoneCounter = 0;
  function nextPhone(): string {
    phoneCounter += 1;
    return `+549351${(4000000 + phoneCounter).toString().padStart(7, "0")}`;
  }

  async function createUser(
    options: { roles?: UserRole[]; emailVerified?: boolean; status?: "active" | "banned" | "deleted" } = {}
  ): Promise<User> {
    const input: CreateUserInput = {
      email: `admin-${randomUUID()}@movo.test`,
      phone: nextPhone(),
      firstName: "Alena",
      lastName: "Ariza",
      passwordHash,
      roles: options.roles ?? [UserRole.SENDER, UserRole.CARRIER, UserRole.ADMIN],
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
    return { ...user, emailVerified: options.emailVerified ?? true };
  }

  function adminLogin(email: string, password = PASSWORD, clientIp = "10.0.0.1") {
    return app.inject({
      method: "POST",
      url: "/auth/admin/login",
      headers: { "x-client-ip": clientIp },
      payload: { email, password },
    });
  }

  function adminVerify(challengeId: string, code: string) {
    return app.inject({ method: "POST", url: "/auth/admin/verify", payload: { challengeId, code } });
  }

  function adminRefresh(refreshToken: string) {
    return app.inject({ method: "POST", url: "/auth/admin/refresh", payload: { refreshToken } });
  }

  async function openPanelSession(user: User): Promise<PanelSessionBody> {
    const login = await adminLogin(user.email);
    expect(login.statusCode).toBe(200);
    const { challengeId } = JSON.parse(login.body) as { challengeId: string };
    const code = emailCaptor.sentCodes.get(user.email);
    if (!code) {
      throw new Error("No se capturó ningún código por email");
    }
    const verify = await adminVerify(challengeId, code);
    expect(verify.statusCode).toBe(200);
    return JSON.parse(verify.body) as PanelSessionBody;
  }

  function claimsOf(accessToken: string) {
    const result = verifyAccessToken(accessToken);
    if (result.status !== "valid") {
      throw new Error("access token inválido");
    }
    return result.claims;
  }

  describe("login en dos pasos (AC1, AC2)", () => {
    it("el paso 1 manda el código por email y nunca emite tokens", async () => {
      const user = await createUser();

      const response = await adminLogin(user.email.toUpperCase());

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Object.keys(body).sort()).toEqual(["challengeId", "cooldownSeconds"]);
      expect(emailCaptor.sentCodes.get(user.email)).toMatch(/^\d{6}$/);
    });

    it("el paso 2 emite un access token de 15 min con admin y una sesión de 8 h", async () => {
      const user = await createUser();
      const before = Math.floor(Date.now() / 1000);

      const session = await openPanelSession(user);

      const claims = claimsOf(session.accessToken);
      expect(claims.roles).toContain(UserRole.ADMIN);
      // El gateway solo respeta `admin` con este claim (review de PR #244).
      expect(claims.session).toBe("panel");
      expect(claims.exp - claims.iat).toBe(15 * 60);
      expect(session.expiresIn).toBe(15 * 60);
      expect(session.roles).toContain(UserRole.ADMIN);
      const sessionExpiresAt = Math.floor(new Date(session.sessionExpiresAt).getTime() / 1000);
      expect(sessionExpiresAt).toBeGreaterThanOrEqual(before + PANEL_SESSION_TTL_SECONDS);
      expect(sessionExpiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + PANEL_SESSION_TTL_SECONDS);

      const [tokenId] = session.refreshToken.split(".").slice(1);
      expect(await app.redis.exists(`panel-refresh:${user.id}:${tokenId}`)).toBe(1);
      expect(await app.redis.exists(`refresh:${user.id}:${tokenId}`)).toBe(0);
    });

    it("el código es de un solo uso", async () => {
      const user = await createUser();
      const login = await adminLogin(user.email);
      const { challengeId } = JSON.parse(login.body) as { challengeId: string };
      const code = emailCaptor.sentCodes.get(user.email)!;

      expect((await adminVerify(challengeId, code)).statusCode).toBe(200);
      expect((await adminVerify(challengeId, code)).statusCode).toBe(422);
    });

    it("un código incorrecto da 401 y al quinto intento invalida el desafío", async () => {
      const user = await createUser();
      const login = await adminLogin(user.email);
      const { challengeId } = JSON.parse(login.body) as { challengeId: string };
      const code = emailCaptor.sentCodes.get(user.email)!;
      const wrong = code === "000000" ? "111111" : "000000";

      for (let i = 0; i < 5; i++) {
        const response = await adminVerify(challengeId, wrong);
        expect(response.statusCode).toBe(401);
      }
      expect((await adminVerify(challengeId, code)).statusCode).toBe(422);
    });

    it("un otpId de otro flujo no abre una sesión de panel", async () => {
      const user = await createUser();
      const otpService = createOtpService(createOtpRepository(app.redis), {
        sms: noopSmsProvider,
        email: emailCaptor.provider,
      });
      const { otpId } = await otpService.generateOtp("email-verify", user.email, { userId: user.id }, "email");
      const code = emailCaptor.sentCodes.get(user.email)!;

      const response = await adminVerify(otpId, code);

      expect(response.statusCode).toBe(401);
    });

    it("si pierde el rol entre el paso 1 y el 2, el verify responde el 401 genérico", async () => {
      const user = await createUser();
      const login = await adminLogin(user.email);
      const { challengeId } = JSON.parse(login.body) as { challengeId: string };
      await app.db.userRoleGrant.deleteMany({ where: { userId: user.id, role: "admin" } });

      const response = await adminVerify(challengeId, emailCaptor.sentCodes.get(user.email)!);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_INVALID_CREDENTIALS");
    });
  });

  describe("errores genéricos (AC3)", () => {
    it("las cuatro causas de rechazo responden igual y no mandan ningún mail", async () => {
      const admin = await createUser();
      const notAdmin = await createUser({ roles: [UserRole.SENDER, UserRole.CARRIER] });
      const unverified = await createUser({ emailVerified: false });
      const banned = await createUser({ status: "banned" });

      const responses = [
        await adminLogin(admin.email, "WrongPassword1"),
        await adminLogin("nadie@movo.test"),
        await adminLogin(notAdmin.email),
        await adminLogin(unverified.email),
        await adminLogin(banned.email),
      ];

      for (const response of responses) {
        expect(response.statusCode).toBe(401);
        expect(JSON.parse(response.body).error).toEqual({
          code: "AUTH_INVALID_CREDENTIALS",
          message: "Credenciales inválidas.",
          statusCode: 401,
        });
      }
      expect(emailCaptor.sentCodes.size).toBe(0);
    });
  });

  describe("la app nunca recibe admin (AC6)", () => {
    it("el mismo admin entra por la app sin admin y por el panel con admin", async () => {
      const user = await createUser();

      const appLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: user.phone, password: PASSWORD },
      });
      expect(appLogin.statusCode).toBe(200);
      const appBody = JSON.parse(appLogin.body) as { accessToken: string; refreshToken: string; roles: string[] };
      expect(claimsOf(appBody.accessToken).roles).toEqual([UserRole.SENDER, UserRole.CARRIER]);
      expect(appBody.roles).not.toContain(UserRole.ADMIN);

      const appRefresh = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: appBody.refreshToken },
      });
      expect(appRefresh.statusCode).toBe(200);
      expect(claimsOf(JSON.parse(appRefresh.body).accessToken).roles).not.toContain(UserRole.ADMIN);

      const panel = await openPanelSession(user);
      expect(claimsOf(panel.accessToken).roles).toContain(UserRole.ADMIN);
    });

    it("un refresh de panel no sirve en /auth/refresh ni uno de la app en /auth/admin/refresh", async () => {
      const user = await createUser();
      const panel = await openPanelSession(user);
      const appLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: user.phone, password: PASSWORD },
      });
      const appRefreshToken = (JSON.parse(appLogin.body) as { refreshToken: string }).refreshToken;

      const panelOnApp = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: panel.refreshToken },
      });
      expect(panelOnApp.statusCode).toBe(401);
      expect((await adminRefresh(appRefreshToken)).statusCode).toBe(401);
    });
  });

  describe("refresh idempotente (MOVO-291)", () => {
    function duplicate(token: string, key = "duplicate-request-123456") {
      return app.inject({ method: "POST", url: "/auth/admin/refresh", headers: { "idempotency-key": key }, payload: { refreshToken: token } });
    }
    it("solicitudes concurrentes comparten una sola rotación cifrada", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      const results = await Promise.all(Array.from({ length: 8 }, () => duplicate(session.refreshToken)));
      expect(results.map(r => r.statusCode)).toEqual(Array(8).fill(200));
      expect(new Set(results.map(r => r.body)).size).toBe(1);
      expect(await app.redis.keys(`panel-refresh:${user.id}:*`)).toHaveLength(2);
      const { createHash } = await import("node:crypto");
      const cached = await app.redis.get(`panel-rotation:${createHash("sha256").update(session.refreshToken).digest("hex")}`);
      expect(cached).not.toContain(JSON.parse(results[0].body).accessToken);
      expect(cached).not.toContain(JSON.parse(results[0].body).refreshToken);
    });
    it("otra clave conserva detección de reuso e invalida la caché", async () => {
      const session = await openPanelSession(await createUser());
      expect((await duplicate(session.refreshToken)).statusCode).toBe(200);
      expect((await duplicate(session.refreshToken, "different-request-123456")).statusCode).toBe(401);
      expect((await duplicate(session.refreshToken)).statusCode).toBe(401);
    });
    for (const logoutOld of [false, true]) {
      it(`logout del token ${logoutOld ? "anterior" : "nuevo"} impide reutilizar el resultado`, async () => {
        const user = await createUser();
        const session = await openPanelSession(user);
        const rotated = JSON.parse((await duplicate(session.refreshToken)).body) as PanelSessionBody;
        await app.inject({ method: "POST", url: "/auth/admin/logout", headers: { "x-user-id": user.id }, payload: { refreshToken: logoutOld ? session.refreshToken : rotated.refreshToken } });
        expect((await duplicate(session.refreshToken)).statusCode).toBe(401);
        expect((await adminRefresh(rotated.refreshToken)).statusCode).toBe(401);
      });
    }
    it("revocación impide devolver el resultado compartido", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      expect((await duplicate(session.refreshToken)).statusCode).toBe(200);
      await createSessionRepository(app.redis).revokePanelSessionsForUser(user.id);
      expect((await duplicate(session.refreshToken)).statusCode).toBe(401);
    });
    it("revocación durante la emisión impide publicar la respuesta", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      const sessions = createSessionRepository(app.redis);
      const save = sessions.savePanelRefreshToken.bind(sessions);
      vi.spyOn(sessions, "savePanelRefreshToken").mockImplementation(async (...args) => {
        const result = await save(...args);
        await sessions.revokePanelSessionsForUser(user.id);
        return result;
      });
      const service = createAdminSessionService(app.db, app.redis, { generateOtp: vi.fn(), verifyOtp: vi.fn() }, sessions);
      await expect(service.refresh(session.refreshToken, "concurrent-revocation-1234")).rejects.toMatchObject({ statusCode: 401 });
      expect(await app.redis.keys(`panel-refresh:${user.id}:*`)).toHaveLength(0);
    });
    it("logout durante la emisión impide publicar y revoca el hijo sin cortar otras sesiones", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      emailCaptor.sentCodes.clear();
      const other = await openPanelSession(user);
      const sessions = createSessionRepository(app.redis);
      const save = sessions.savePanelRefreshToken.bind(sessions);
      const service = createAdminSessionService(app.db, app.redis, { generateOtp: vi.fn(), verifyOtp: vi.fn() }, sessions);
      vi.spyOn(sessions, "savePanelRefreshToken").mockImplementation(async (...args) => {
        const result = await save(...args);
        await service.logout(session.refreshToken, user.id);
        return result;
      });
      await expect(service.refresh(session.refreshToken, "logout-during-refresh-1234")).rejects.toMatchObject({ statusCode: 401 });
      expect(await app.redis.keys(`panel-refresh:${user.id}:*`)).toHaveLength(1);
      expect((await adminRefresh(other.refreshToken)).statusCode).toBe(200);
    });
    it("una rotación incompleta falla cerrado sin consumir dos veces", async () => {
      const session = await openPanelSession(await createUser());
      const sessions = createSessionRepository(app.redis);
      const consume = vi.spyOn(sessions, "consumePanelRefreshToken");
      vi.spyOn(sessions, "savePanelRefreshToken").mockRejectedValue(new Error("storage failed"));
      const service = createAdminSessionService(app.db, app.redis, { generateOtp: vi.fn(), verifyOtp: vi.fn() }, sessions);
      await expect(service.refresh(session.refreshToken, "incomplete-rotation-1234")).rejects.toThrow("storage failed");
      await expect(service.refresh(session.refreshToken, "incomplete-rotation-1234")).rejects.toMatchObject({ statusCode: 503 });
      expect(consume).toHaveBeenCalledTimes(1);
    });
    it("si el primer refresh falla por sesión vencida, los duplicados concurrentes responden 401 enseguida", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      await createSessionRepository(app.redis).revokePanelSessionsForUser(user.id);
      const started = Date.now();
      const results = await Promise.all(Array.from({ length: 4 }, () => duplicate(session.refreshToken)));
      expect(results.map(r => r.statusCode)).toEqual(Array(4).fill(401));
      expect(Date.now() - started).toBeLessThan(1500);
    });
    it("fuera de la ventana la repetición es reuso", async () => {
      const session = await openPanelSession(await createUser());
      expect((await duplicate(session.refreshToken)).statusCode).toBe(200);
      const { createHash } = await import("node:crypto");
      await app.redis.del(`panel-rotation:${createHash("sha256").update(session.refreshToken).digest("hex")}`);
      expect((await duplicate(session.refreshToken)).statusCode).toBe(401);
    });
  });

  describe("refresh de la sesión de panel (AC4, AC5)", () => {
    it("rotar el refresh conserva el vencimiento absoluto de 8 h", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);

      let refreshToken = session.refreshToken;
      for (let i = 0; i < 3; i++) {
        const response = await adminRefresh(refreshToken);
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as PanelSessionBody;
        expect(body.sessionExpiresAt).toBe(session.sessionExpiresAt);
        expect(claimsOf(body.accessToken).roles).toContain(UserRole.ADMIN);
        refreshToken = body.refreshToken;
      }

      const [tokenId] = refreshToken.split(".").slice(1);
      const ttl = await app.redis.ttl(`panel-refresh:${user.id}:${tokenId}`);
      const remaining = Math.ceil((new Date(session.sessionExpiresAt).getTime() - Date.now()) / 1000);
      expect(ttl).toBeLessThanOrEqual(remaining);
    });

    it("la sesión no supera las 8 h aunque se rote el refresh", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      const rotated = JSON.parse((await adminRefresh(session.refreshToken)).body) as PanelSessionBody;

      // Adelanta el reloj más allá del vencimiento absoluto: aunque la key siguiera en
      // Redis (su TTL es real, no se mueve con el reloj falso), el refresh se rechaza.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(session.sessionExpiresAt).getTime() + 1000);

      const response = await adminRefresh(rotated.refreshToken);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_REFRESH_INVALID");
    });

    it("después de revocar el rol, el refresh responde 401 y borra las sesiones de panel", async () => {
      const user = await createUser();
      const first = await openPanelSession(user);
      emailCaptor.sentCodes.clear();
      const second = await openPanelSession(user);
      await app.db.userRoleGrant.deleteMany({ where: { userId: user.id, role: "admin" } });

      const response = await adminRefresh(first.refreshToken);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_REFRESH_INVALID");
      expect((await adminRefresh(second.refreshToken)).statusCode).toBe(401);
      expect(await app.redis.keys(`panel-refresh:${user.id}:*`)).toEqual([]);
      expect(await app.redis.exists(`panel-revoked-at:${user.id}`)).toBe(1);
    });

    it("un refresh armado a mano con ':' en los ids responde 401, no 500 (review de PR #244)", async () => {
      const response = await adminRefresh("a:b.c.d");

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.code).toBe("AUTH_REFRESH_INVALID");
    });

    it("después de suspender la cuenta, el refresh responde 401", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      await app.db.user.update({ where: { id: user.id }, data: { status: "banned" } });

      expect((await adminRefresh(session.refreshToken)).statusCode).toBe(401);
    });

    it("reusar un refresh ya rotado revoca las sesiones de panel pero no las de la app", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      const appLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: user.phone, password: PASSWORD },
      });
      const appRefreshToken = (JSON.parse(appLogin.body) as { refreshToken: string }).refreshToken;
      const rotated = JSON.parse((await adminRefresh(session.refreshToken)).body) as PanelSessionBody;

      expect((await adminRefresh(session.refreshToken)).statusCode).toBe(401);
      expect((await adminRefresh(rotated.refreshToken)).statusCode).toBe(401);

      const appRefresh = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: appRefreshToken },
      });
      expect(appRefresh.statusCode).toBe(200);
    });
  });

  describe("corte inmediato (AC7)", () => {
    it("revokePanelSessions corta las sesiones de panel sin tocar las de la app", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);
      const appLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { phone: user.phone, password: PASSWORD },
      });
      const appRefreshToken = (JSON.parse(appLogin.body) as { refreshToken: string }).refreshToken;
      const otpService = createOtpService(createOtpRepository(app.redis), {
        sms: noopSmsProvider,
        email: emailCaptor.provider,
      });
      const service = createAdminSessionService(app.db, app.redis, otpService, createSessionRepository(app.redis));

      await service.revokePanelSessions(user.id);

      expect((await adminRefresh(session.refreshToken)).statusCode).toBe(401);
      expect(await app.redis.exists(`panel-revoked-at:${user.id}`)).toBe(1);
      expect(await app.redis.exists(`user-revoked-at:${user.id}`)).toBe(0);
      const appRefresh = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: appRefreshToken },
      });
      expect(appRefresh.statusCode).toBe(200);
    });
  });

  describe("logout del panel (AC8)", () => {
    it("revoca solo la sesión actual y es idempotente", async () => {
      const user = await createUser();
      const first = await openPanelSession(user);
      emailCaptor.sentCodes.clear();
      const second = await openPanelSession(user);

      for (let i = 0; i < 2; i++) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/admin/logout",
          headers: { "x-user-id": user.id },
          payload: { refreshToken: first.refreshToken },
        });
        expect(response.statusCode).toBe(204);
      }

      expect((await adminRefresh(first.refreshToken)).statusCode).toBe(401);
      expect((await adminRefresh(second.refreshToken)).statusCode).toBe(200);
    });

    it("no revoca la sesión de otro usuario", async () => {
      const user = await createUser();
      const session = await openPanelSession(user);

      const response = await app.inject({
        method: "POST",
        url: "/auth/admin/logout",
        headers: { "x-user-id": randomUUID() },
        payload: { refreshToken: session.refreshToken },
      });

      expect(response.statusCode).toBe(204);
      expect((await adminRefresh(session.refreshToken)).statusCode).toBe(200);
    });
  });

  describe("rate limit por email + IP (AC9, review de PR #244)", () => {
    it("bloquear un email desde una IP no deja afuera al admin que entra desde otra", async () => {
      const user = await createUser();
      for (let i = 0; i < 6; i++) {
        await adminLogin(user.email, "WrongPassword1", "203.0.113.66");
      }
      expect((await adminLogin(user.email, "WrongPassword1", "203.0.113.66")).statusCode).toBe(429);

      expect((await adminLogin(user.email, PASSWORD, "198.51.100.7")).statusCode).toBe(200);
    });

    it("el contador siempre tiene TTL", async () => {
      const user = await createUser();
      await adminLogin(user.email, "WrongPassword1", "203.0.113.67");

      const [key] = await app.redis.keys("admin-login-attempts:*");
      const ttl = await app.redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(15 * 60);
    });

    it("el sexto intento en 15 min da 429, exista o no la cuenta", async () => {
      const user = await createUser();

      for (const email of [user.email, "nadie@movo.test"]) {
        for (let i = 0; i < 5; i++) {
          const response = await adminLogin(email, "WrongPassword1");
          expect(response.statusCode).toBe(401);
        }
        const sixth = await adminLogin(email, "WrongPassword1");
        expect(sixth.statusCode).toBe(429);
        expect(JSON.parse(sixth.body).error.code).toBe("RATE_LIMIT_EXCEEDED");
      }
    });
  });

  describe("Swagger (AC10)", () => {
    it("documenta los cuatro endpoints del panel", async () => {
      const response = await app.inject({ method: "GET", url: "/docs/json" });
      const paths = Object.keys(JSON.parse(response.body).paths as Record<string, unknown>);

      expect(paths).toEqual(
        expect.arrayContaining(["/auth/admin/login", "/auth/admin/verify", "/auth/admin/refresh", "/auth/admin/logout"])
      );
    });
  });
});
