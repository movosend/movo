import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { AdminUserModeration, AdminUserPage, AdminUserProfile, LEGAL_DOCUMENT_VERSIONS, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";
import { createSessionRepository } from "../src/repositories/session-repository";
import { CreateUserInput, User } from "../src/models/user";
import { EmailBody, EmailProvider } from "../src/adapters/email-provider";
import { SmsProvider } from "../src/adapters/sms-provider";

interface SentEmail {
  to: string;
  subject: string;
  body: EmailBody;
}

function createCaptorEmailProvider() {
  const sent: SentEmail[] = [];
  let failing = false;
  const provider: EmailProvider = {
    async send(to: string, subject: string, body: EmailBody): Promise<void> {
      if (failing) throw new Error("proveedor caído");
      sent.push({ to, subject, body });
    },
  };
  return { provider, sent, setFailing: (value: boolean) => (failing = value) };
}

const noopSmsProvider: SmsProvider = {
  async send(): Promise<void> {},
  async sendText(): Promise<void> {},
};

describe("Búsqueda, ficha y acciones de soporte del panel (MOVO-294)", () => {
  let app: FastifyInstance;
  let repo: UserRepository;
  let emailCaptor: ReturnType<typeof createCaptorEmailProvider>;
  const adminId = randomUUID();

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    emailCaptor = createCaptorEmailProvider();
    app = buildApp({ emailProvider: emailCaptor.provider, smsProvider: noopSmsProvider, orphanPhotoSweepEnabled: false });
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
    emailCaptor.sent.length = 0;
    emailCaptor.setFailing(false);
  });

  let phoneCounter = 0;
  function nextPhone(): string {
    phoneCounter += 1;
    return `+549351${(6000000 + phoneCounter).toString().padStart(7, "0")}`;
  }

  async function createUser(
    overrides: Partial<Pick<CreateUserInput, "email" | "phone" | "firstName" | "lastName" | "dni">> & { admin?: boolean } = {}
  ): Promise<User> {
    const input: CreateUserInput = {
      email: overrides.email ?? `user-${randomUUID()}@movo.test`,
      phone: overrides.phone ?? nextPhone(),
      firstName: overrides.firstName ?? "Lucas",
      lastName: overrides.lastName ?? "Dalmagro",
      passwordHash: "hash",
      ...(overrides.dni ? { dni: overrides.dni } : {}),
      roles: overrides.admin ? [UserRole.SENDER, UserRole.ADMIN] : [UserRole.SENDER],
      termsAcceptedAt: new Date(),
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
      privacyAcceptedAt: new Date(),
      privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
      phoneVerified: true,
      address: { street: "Av. Colón", number: "1234", city: "Córdoba", province: "Córdoba", zip: "5000", lat: -31.42, long: -64.19 },
    };
    return repo.create(input);
  }

  async function search(q?: string, extra = ""): Promise<AdminUserPage> {
    const query = q === undefined ? "" : `q=${encodeURIComponent(q)}`;
    const res = await app.inject({ method: "GET", url: `/internal/admin/users?${query}${extra}` });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as AdminUserPage;
  }

  describe("GET /internal/admin/users", () => {
    it("sin q lista todas las cuentas, más recientes primero, incluidas las dadas de baja", async () => {
      const first = await createUser();
      const second = await createUser();
      await repo.anonymizeAndDelete(first.id);

      const page = await search();
      expect(page.total).toBe(2);
      expect(page.items.map((item) => item.id)).toEqual([second.id, first.id]);
      expect(page.items[1]?.accountStatus).toBe("deleted");
      expect(page.items.every((item) => item.matchedBy === null)).toBe(true);
    });

    it("por nombre, sin tildes ni mayúsculas y en los dos órdenes", async () => {
      const user = await createUser({ firstName: "José", lastName: "Núñez" });
      await createUser({ firstName: "Pedro", lastName: "Yorlano" });

      for (const q of ["jose", "NUNEZ", "josé núñez", "Nunez Jose"]) {
        const page = await search(q);
        expect(page.items.map((item) => item.id), q).toEqual([user.id]);
        expect(page.items[0]?.matchedBy).toBe("name");
      }
    });

    it("por email, como substring y sin distinguir mayúsculas", async () => {
      const user = await createUser({ email: "alena.ariza@movo.test" });
      await createUser();

      const page = await search("ARIZA@movo");
      expect(page.items.map((item) => item.id)).toEqual([user.id]);
      expect(page.items[0]?.matchedBy).toBe("email");
    });

    it("por DNI, con o sin puntos y parcial desde 3 dígitos", async () => {
      // Emails fijos: un UUID aleatorio podría contener los dígitos buscados y coincidir por email.
      const user = await createUser({ dni: "33812405", email: "dni-a@movo.test" });
      await createUser({ dni: "20111222", email: "dni-b@movo.test" });

      for (const q of ["33812405", "33.812.405", "812"]) {
        const page = await search(q);
        expect(page.items.map((item) => item.id), q).toEqual([user.id]);
        expect(page.items[0]?.matchedBy).toBe("dni");
      }
      expect((await search("33")).total).toBe(0);
    });

    it("por teléfono en los formatos que acepta el login, con espacios, guiones y el 0 de larga distancia", async () => {
      const user = await createUser({ phone: "+5493514567890" });
      await createUser({ phone: "+5491122223333" });

      for (const q of ["+5493514567890", "+54 9 351 456-7890", "3514567890", "0351 456 7890", "0351-4567890", "549 351 4567890", "4567"]) {
        const page = await search(q);
        expect(page.items.map((item) => item.id), q).toEqual([user.id]);
        expect(page.items[0]?.matchedBy).toBe("phone");
      }
    });

    it("pagina con page/pageSize y devuelve el total", async () => {
      for (let i = 0; i < 3; i += 1) await createUser({ firstName: "Tomás", lastName: `Vergara${i}` });
      await createUser({ firstName: "Otro", lastName: "Nombre" });

      const first = await search("tomas", "&pageSize=2&page=1");
      const second = await search("tomas", "&pageSize=2&page=2");
      expect(first.total).toBe(3);
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(3);
    });

    it("escapa los comodines de LIKE en la búsqueda", async () => {
      await createUser({ email: "abc@movo.test" });
      expect((await search("%")).total).toBe(0);
      expect((await search("_")).total).toBe(0);
    });

    it("rechaza un pageSize fuera de rango", async () => {
      const res = await app.inject({ method: "GET", url: "/internal/admin/users?pageSize=51" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("ficha", () => {
    it("GET /:id devuelve el perfil completo con roles; la cuenta dada de baja trae deletedAt", async () => {
      const user = await createUser({ admin: true, dni: "30111222" });
      const res = await app.inject({ method: "GET", url: `/internal/admin/users/${user.id}` });
      expect(res.statusCode).toBe(200);
      const profile = JSON.parse(res.body) as AdminUserProfile;
      expect(profile).toMatchObject({ id: user.id, fullName: "Lucas Dalmagro", dni: "30111222", accountStatus: "active", deletedAt: null });
      expect(profile.roles.map((grant) => grant.role).sort()).toEqual(["admin", "sender"]);

      await repo.anonymizeAndDelete(user.id);
      const deleted = JSON.parse((await app.inject({ method: "GET", url: `/internal/admin/users/${user.id}` })).body) as AdminUserProfile;
      expect(deleted.accountStatus).toBe("deleted");
      expect(deleted.deletedAt).not.toBeNull();
    });

    it("un usuario inexistente es 404 USER_NOT_FOUND en cada sección", async () => {
      const id = randomUUID();
      for (const section of ["", "/kyc", "/vehicle", "/moderation", "/devices"]) {
        const res = await app.inject({ method: "GET", url: `/internal/admin/users/${id}${section}` });
        expect(res.statusCode, section).toBe(404);
        expect(JSON.parse(res.body).error.code).toBe("USER_NOT_FOUND");
      }
    });

    it("KYC: intentos de la más vieja a la más nueva, con el motivo del rechazo y sin datos biométricos", async () => {
      const user = await createUser();
      await app.db.kycVerification.create({
        data: {
          userId: user.id,
          verificationType: "identity",
          provider: "didit",
          externalSessionId: `s-${randomUUID()}`,
          status: "rejected",
          requestedAt: new Date("2026-10-01T10:00:00Z"),
          resolvedAt: new Date("2026-10-01T10:05:00Z"),
          rawDecision: { status: "Declined", warnings: [{ feature: "ocr", risk: "high", description: "La foto del DNI salió borrosa" }] },
        },
      });
      const latest = await app.db.kycVerification.create({
        data: {
          userId: user.id,
          verificationType: "identity",
          provider: "didit",
          externalSessionId: `s-${randomUUID()}`,
          status: "approved",
          requestedAt: new Date("2026-10-02T10:00:00Z"),
          rawDecision: { status: "Approved", warnings: [{ description: "ignorado en un aprobado" }] },
        },
      });
      await app.db.user.update({ where: { id: user.id }, data: { kycStatusIdentity: "approved" } });

      const kyc = JSON.parse((await app.inject({ method: "GET", url: `/internal/admin/users/${user.id}/kyc` })).body);
      expect(kyc.identity.status).toBe("approved");
      expect(kyc.identity.lastSessionId).toBe(latest.externalSessionId);
      expect(kyc.identity.attempts.map((a: { status: string }) => a.status)).toEqual(["rejected", "approved"]);
      expect(kyc.identity.attempts[0].reason).toBe("La foto del DNI salió borrosa");
      expect(kyc.identity.attempts[1].reason).toBeNull();
      expect(kyc.license).toMatchObject({ status: "not_started", lastSessionId: null, attempts: [], expiresAt: null });
      expect(JSON.stringify(kyc)).not.toContain("rawDecision");
    });

    it("moderación: reportes y bloqueos en las dos direcciones, con contrapartes y totales", async () => {
      const user = await createUser({ firstName: "Ana", lastName: "Ariza" });
      const other = await createUser({ firstName: "Juan", lastName: "Bordino" });
      const report = await app.db.userReport.create({ data: { reporterId: other.id, reportedId: user.id, reason: "harassment", details: "Me insultó" } });
      await app.db.userReportEntry.create({ data: { reportId: report.id, details: "Otra vez" } });
      await app.db.userReportPhoto.create({ data: { reportId: report.id, s3Key: `reports/${other.id}/${randomUUID()}.jpg` } });
      await app.db.userReport.create({ data: { reporterId: user.id, reportedId: other.id, reason: "no_show" } });
      await app.db.userBlock.create({ data: { blockerId: user.id, blockedId: other.id } });
      await app.db.userBlock.create({ data: { blockerId: other.id, blockedId: user.id } });

      const moderation = JSON.parse((await app.inject({ method: "GET", url: `/internal/admin/users/${user.id}/moderation` })).body) as AdminUserModeration;
      expect(moderation.reports.received).toHaveLength(1);
      expect(moderation.reports.received[0]).toMatchObject({
        reason: "harassment",
        counterpart: { id: other.id, fullName: "Juan Bordino" },
        extraEntries: 1,
        photos: 1,
      });
      expect(JSON.stringify(moderation)).not.toContain("s3Key");
      expect(moderation.reports.made[0]?.counterpart.id).toBe(other.id);
      expect(moderation.blocks.made[0]?.user.id).toBe(other.id);
      expect(moderation.blocks.received[0]?.user.id).toBe(other.id);
      expect(moderation.totals).toEqual({ reportsReceived: 1, reportsMade: 1, blocksMade: 1, blocksReceived: 1 });
    });

    it("dispositivos y vehículo, sin el token de Expo ni la clave pública", async () => {
      const user = await createUser();
      await app.db.pushToken.create({ data: { userId: user.id, expoPushToken: "ExponentPushToken[secreto]", deviceId: "device-1", platform: "android" } });
      await app.db.deviceKey.create({ data: { userId: user.id, publicKey: "clave-publica-secreta" } });
      await app.db.vehicleProfile.create({
        data: { userId: user.id, brand: "Fiat", model: "Cronos", cargoCapacityLabel: "Baúl mediano", licensePlate: "AB123CD" },
      });

      const devicesRes = await app.inject({ method: "GET", url: `/internal/admin/users/${user.id}/devices` });
      const devices = JSON.parse(devicesRes.body);
      expect(devices.devices).toEqual([expect.objectContaining({ platform: "android", deviceId: "device-1" })]);
      expect(devices.handshakeKey.registeredAt).toEqual(expect.any(String));
      expect(devicesRes.body).not.toContain("secreto");

      const vehicle = JSON.parse((await app.inject({ method: "GET", url: `/internal/admin/users/${user.id}/vehicle` })).body);
      expect(vehicle.vehicle).toEqual({ brand: "Fiat", model: "Cronos", licensePlate: "AB123CD", cargoCapacityLabel: "Baúl mediano" });
    });

    it("POST /names resuelve los nombres que existen", async () => {
      const user = await createUser({ firstName: "Pedro", lastName: "Yorlano" });
      const res = await app.inject({ method: "POST", url: "/internal/admin/users/names", payload: { ids: [user.id, randomUUID()] } });
      expect(JSON.parse(res.body)).toEqual({ users: [{ id: user.id, fullName: "Pedro Yorlano" }] });
    });
  });

  describe("acciones de soporte", () => {
    const sessions = () => createSessionRepository(app.redis);
    const headers = { "x-user-id": adminId };

    async function seedSessions(userId: string): Promise<void> {
      await sessions().saveRefreshToken(userId, randomUUID(), { hash: "h", used: false });
      await sessions().saveRefreshToken(userId, randomUUID(), { hash: "h", used: false });
    }

    it("cerrar sesiones revoca los refresh y marca el corte de los access tokens ya emitidos", async () => {
      const user = await createUser();
      await seedSessions(user.id);

      const res = await app.inject({ method: "POST", url: `/internal/admin/users/${user.id}/sessions/revoke`, headers });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ revokedRefreshTokens: 2 });
      expect(await app.redis.keys(`refresh:${user.id}:*`)).toEqual([]);
      expect(await app.redis.get(`user-revoked-at:${user.id}`)).not.toBeNull();
    });

    it("cerrar sesiones de un admin corta también las del panel", async () => {
      const user = await createUser({ admin: true });
      await app.inject({ method: "POST", url: `/internal/admin/users/${user.id}/sessions/revoke`, headers });
      expect(await app.redis.get(`panel-revoked-at:${user.id}`)).not.toBeNull();
    });

    it("las acciones sobre una cuenta dada de baja son 409 USER_DELETED", async () => {
      const user = await createUser();
      await repo.anonymizeAndDelete(user.id);
      const revoke = await app.inject({ method: "POST", url: `/internal/admin/users/${user.id}/sessions/revoke`, headers });
      expect(JSON.parse(revoke.body).error.code).toBe("USER_DELETED");
      const contact = await app.inject({
        method: "POST",
        url: `/internal/admin/users/${user.id}/contact`,
        headers,
        payload: { field: "email", newValue: "nuevo@movo.test", expectedCurrent: `deleted+${user.id}@movo.invalid` },
      });
      expect(contact.statusCode).toBe(409);
      expect(JSON.parse(contact.body).error.code).toBe("USER_DELETED");
    });

    function changeContact(userId: string, payload: Record<string, string>) {
      return app.inject({ method: "POST", url: `/internal/admin/users/${userId}/contact`, headers, payload });
    }

    it("cambiar el email lo deja sin verificar, cierra sesiones y avisa al anterior y al nuevo", async () => {
      const user = await createUser({ email: "viejo@movo.test" });
      await app.db.user.update({ where: { id: user.id }, data: { emailVerified: true, emailVerifiedAt: new Date() } });
      await seedSessions(user.id);

      const res = await changeContact(user.id, { field: "email", newValue: "  Nuevo@Movo.test ", expectedCurrent: "viejo@movo.test" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ email: "nuevo@movo.test", emailVerified: false, revokedRefreshTokens: 2, noticeFailed: false });
      expect((await app.db.user.findUnique({ where: { id: user.id } }))?.emailVerifiedAt).toBeNull();
      expect(await app.redis.get(`user-revoked-at:${user.id}`)).not.toBeNull();
      expect(emailCaptor.sent.map((mail) => mail.to).sort()).toEqual(["nuevo@movo.test", "viejo@movo.test"]);
    });

    it("cambiar el teléfono lo normaliza como el login y lo deja sin verificar", async () => {
      const user = await createUser({ phone: "+5493510000001" });
      const res = await changeContact(user.id, { field: "phone", newValue: "351 222-3333", expectedCurrent: "+54 9 351 000 0001" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ phone: "+5493512223333", phoneVerified: false });
      expect(emailCaptor.sent.map((mail) => mail.to)).toEqual([user.email]);
    });

    it("un email de otra cuenta con otra capitalización es 409 EMAIL_ALREADY_IN_USE", async () => {
      await createUser({ email: "tomado@movo.test" });
      const user = await createUser();
      const res = await changeContact(user.id, { field: "email", newValue: "TOMADO@movo.test", expectedCurrent: user.email });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe("EMAIL_ALREADY_IN_USE");
    });

    it("un teléfono de otra cuenta escrito en otro formato es 409 PHONE_ALREADY_IN_USE", async () => {
      await createUser({ phone: "+5493514445555" });
      const user = await createUser();
      const res = await changeContact(user.id, { field: "phone", newValue: "+54 351 444-5555", expectedCurrent: user.phone });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe("PHONE_ALREADY_IN_USE");
    });

    it("si el valor actual ya no es el que vio el admin es 409 CONTACT_CHANGED y no toca nada", async () => {
      const user = await createUser({ email: "actual@movo.test" });
      const res = await changeContact(user.id, { field: "email", newValue: "nuevo@movo.test", expectedCurrent: "otro@movo.test" });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe("CONTACT_CHANGED");
      expect((await repo.findById(user.id))?.email).toBe("actual@movo.test");
    });

    it("el mismo valor es 400 CONTACT_UNCHANGED y un formato inválido es 400 VALIDATION_FAILED", async () => {
      const user = await createUser({ email: "igual@movo.test" });
      const same = await changeContact(user.id, { field: "email", newValue: "IGUAL@movo.test", expectedCurrent: "igual@movo.test" });
      expect(JSON.parse(same.body).error.code).toBe("CONTACT_UNCHANGED");
      const invalid = await changeContact(user.id, { field: "phone", newValue: "12", expectedCurrent: user.phone });
      expect(invalid.statusCode).toBe(400);
      expect(JSON.parse(invalid.body).error.code).toBe("VALIDATION_FAILED");
    });

    it("si el aviso falla el cambio queda aplicado y lo informa", async () => {
      const user = await createUser();
      emailCaptor.setFailing(true);
      const res = await changeContact(user.id, { field: "email", newValue: "nuevo@movo.test", expectedCurrent: user.email });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).noticeFailed).toBe(true);
      expect((await repo.findById(user.id))?.email).toBe("nuevo@movo.test");
    });

    it("las escrituras exigen x-user-id del admin", async () => {
      const user = await createUser();
      const res = await app.inject({ method: "POST", url: `/internal/admin/users/${user.id}/sessions/revoke` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("re-verificar el teléfono después de un cambio de soporte", () => {
    it("el flujo de cambio de teléfono acepta el mismo número si está sin verificar", async () => {
      const user = await createUser();
      await app.db.user.update({ where: { id: user.id }, data: { phoneVerified: false } });
      const res = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/otp",
        headers: { "x-user-id": user.id },
        payload: { phone: user.phone },
      });
      expect(res.statusCode).toBe(200);
    });

    it("y lo sigue rechazando si ya está verificado", async () => {
      const user = await createUser();
      const res = await app.inject({
        method: "POST",
        url: "/users/me/phone/change/otp",
        headers: { "x-user-id": user.id },
        payload: { phone: user.phone },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
