import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { argentinaDayBounds, toArgentinaCalendarDateString, UserRole } from "@movo/shared";
import { buildApp } from "../src/app";
import { createUserRepository, UserRepository } from "../src/repositories/user-repository";

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

/** MOVO-342: bandejas de la home del panel que viven en `svc-users`, contra Postgres real con fechas fijas. */
describe("home del panel (Postgres) — MOVO-342", () => {
  let app: FastifyInstance;
  let repo: UserRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
    repo = createUserRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  // Las bandejas cuentan toda la tabla: cada test arranca sin estas filas (los usuarios de otros tests no molestan).
  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE users.kyc_verification, users.user_reports, users.user_blocks, users.account_sanctions CASCADE",
    );
  });

  function createUser() {
    return repo.create({
      email: `user-${randomUUID()}@movo.test`,
      phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
      firstName: "Alena",
      lastName: "Ariza",
      passwordHash: "hashed_password",
      roles: [UserRole.SENDER, UserRole.CARRIER],
      phoneVerified: true,
      address: { street: "Av. Colón", number: "1234", city: "Córdoba", province: "Córdoba", zip: "5000", lat: -31.42, long: -64.18 },
    });
  }

  const get = async (path: string) => {
    const response = await app.inject({ method: "GET", url: `/internal/admin/overview/${path}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  describe("KYC", () => {
    const attempt = (userId: string, verificationType: "identity" | "license", status: string, requestedAt: Date, resolvedAt: Date | null = null) =>
      app.db.kycVerification.create({
        data: { userId, verificationType, provider: "didit", externalSessionId: randomUUID(), status: status as never, requestedAt, resolvedAt },
      });

    it("cuenta el último intento de cada verificación, separa transportistas y emisores y reconstruye ayer", async () => {
      const [a, b, c, d] = await Promise.all([createUser(), createUser(), createUser(), createUser()]);
      await attempt(a.id, "identity", "manual_review", hoursAgo(40));
      await attempt(a.id, "license", "pending", hoursAgo(3));
      // Un intento abandonado y su reintento aprobado: ya no está en la cola, y ayer ya estaba resuelto.
      await attempt(b.id, "identity", "pending", hoursAgo(90));
      await attempt(b.id, "identity", "approved", hoursAgo(80), hoursAgo(79));
      // Pendiente ayer a esta hora, aprobado hoy: cuenta para ayer, no para hoy.
      await attempt(c.id, "license", "approved", hoursAgo(50), hoursAgo(2));
      await attempt(d.id, "identity", "pending", hoursAgo(1));

      const body = await get("kyc");

      expect(body).toMatchObject({ count: 3, carriers: 1, senders: 2, yesterdayCount: 2 });
      expect(body.breakdown).toEqual([
        { key: "identity", count: 2 },
        { key: "license", count: 1 },
      ]);
      expect(Math.round((Date.now() - new Date(body.oldestAt).getTime()) / HOUR_MS)).toBe(40);
    });

    it("una cuenta dada de baja no ocupa la cola", async () => {
      const gone = await createUser();
      await attempt(gone.id, "identity", "manual_review", hoursAgo(5));
      await app.db.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      expect((await get("kyc")).count).toBe(0);
    });
  });

  describe("reportes de usuarios", () => {
    it("cuenta los pendientes, los que además bloquearon y desglosa por motivo", async () => {
      const [reporter, reported, other] = await Promise.all([createUser(), createUser(), createUser()]);
      await app.db.userReport.create({ data: { reporterId: reporter.id, reportedId: reported.id, reason: "harassment", createdAt: hoursAgo(30) } });
      await app.db.userReport.create({ data: { reporterId: other.id, reportedId: reported.id, reason: "harassment", createdAt: hoursAgo(2) } });
      await app.db.userReport.create({ data: { reporterId: other.id, reportedId: reporter.id, reason: "no_show", createdAt: hoursAgo(1) } });
      await app.db.userReport.create({ data: { reporterId: reporter.id, reportedId: other.id, reason: "other", status: "reviewed", createdAt: hoursAgo(90) } });
      await app.db.userBlock.create({ data: { blockerId: reporter.id, blockedId: reported.id } });

      const body = await get("user-reports");

      expect(body).toMatchObject({ count: 3, blockRequested: 1, yesterdayCount: null });
      expect(body.breakdown).toEqual([
        { key: "harassment", count: 2 },
        { key: "no_show", count: 1 },
      ]);
      expect(Math.round((Date.now() - new Date(body.oldestAt).getTime()) / HOUR_MS)).toBe(30);
    });

    it("devuelve a quién apunta cada reporte; un id inexistente no vuelve", async () => {
      const [reporter, reported] = await Promise.all([createUser(), createUser()]);
      const report = await app.db.userReport.create({ data: { reporterId: reporter.id, reportedId: reported.id, reason: "other" } });
      const response = await app.inject({
        method: "POST",
        url: "/internal/admin/user-reports/reported",
        payload: { ids: [report.id, randomUUID()] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ reports: [{ id: report.id, reportedId: reported.id }] });
    });
  });

  describe("sanciones que vencen hoy", () => {
    // Un usuario por sanción: la base admite una sola vigente por cuenta.
    const sanction = async (type: "suspension" | "disable", endsAt: Date, data: Record<string, unknown> = {}) => {
      const user = await createUser();
      return app.db.accountSanction.create({ data: { userId: user.id, type, reason: "x", endsAt, startedAt: hoursAgo(24 * 10), ...data } });
    };

    it("cuenta las del día de Argentina sin levantar, y reconstruye las de ayer", async () => {
      const day = (offset: number) => argentinaDayBounds(toArgentinaCalendarDateString(new Date(Date.now() + offset * 24 * HOUR_MS)));
      const today = day(0);
      await sanction("suspension", today.start);
      await sanction("suspension", new Date(today.end.getTime() - 1));
      await sanction("disable", new Date(today.start.getTime() + HOUR_MS));
      // Fuera del día, o levantada.
      await sanction("suspension", today.end);
      await sanction("suspension", new Date(today.start.getTime() - 1));
      await sanction("suspension", new Date(today.start.getTime() + HOUR_MS), { liftedAt: hoursAgo(1) });

      const body = await get("sanctions-ending-today");

      expect(body.count).toBe(3);
      expect(body.oldestAt).toBe(today.start.toISOString());
      expect(body.breakdown).toEqual([
        { key: "suspension", count: 2 },
        { key: "disable", count: 1 },
      ]);
      // Ayer vencía la que termina un milisegundo antes de hoy.
      expect(body.yesterdayCount).toBe(1);
    });

    it("sin sanciones, vacía", async () => {
      expect(await get("sanctions-ending-today")).toEqual({ count: 0, oldestAt: null, yesterdayCount: 0, breakdown: [] });
    });
  });
});
