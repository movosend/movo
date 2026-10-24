import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { AccountSanction, AdminUserProfile, ApiError, InProgressShipment, WithdrawOpenActivityResult } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakeShipmentsClient, createFakeUsersClient, emptyWithdrawal, shipmentsDown } from "./fake-clients";

const profile = (overrides: Partial<AdminUserProfile> = {}): AdminUserProfile => {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    firstName: "Ana",
    lastName: "Ariza",
    fullName: "Ana Ariza",
    email: `${id}@movo.test`,
    emailVerified: true,
    phone: "+5493511234567",
    phoneVerified: true,
    dni: "30111222",
    birthdate: "1995-04-01",
    photoUrl: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
    roles: [{ role: "sender", grantedAt: "2026-10-01T00:00:00.000Z" }],
    accountStatus: "active",
    bannedUntil: null,
    ...overrides,
  };
};

const ENDS_AT = "2030-01-01T00:00:00.000Z";

/**
 * MOVO-299: la bitácora es real (schema `admin`); `svc-users` y `svc-shipments` son fakes, así cada
 * caso decide cómo responde el retiro. Sin limpiar tablas: cada caso usa usuarios nuevos.
 */
// Cada caso arma su app (fakes propios): en frío, el primero puede pasar los 5 s por defecto.
describe("Sanciones desde la ficha (MOVO-299)", { timeout: 15_000 }, () => {
  let app: FastifyInstance | undefined;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function setup(
    opts: {
      inProgress?: InProgressShipment[];
      withdrawResults?: Array<WithdrawOpenActivityResult | ApiError>;
      sanctions?: AccountSanction[];
      shipmentsDown?: boolean;
    } = {},
  ) {
    const me = profile({ fullName: "Ada Admin", roles: [{ role: "admin", grantedAt: "2026-10-01T00:00:00.000Z" }] });
    const user = profile();
    const withdrawCalls: Array<{ userId: string; sanctionId: string }> = [];
    const sanctions = opts.sanctions ?? [];
    app = buildApp({
      usersClient: createFakeUsersClient({ profiles: [me, user], sanctions }),
      shipmentsClient: createFakeShipmentsClient({
        inProgress: { [user.id]: opts.inProgress ?? [] },
        openActivity: { [user.id]: { shipments: 2, offers: 1, trips: 0, recurringSeries: 1 } },
        withdrawResults: opts.withdrawResults ?? [],
        withdrawCalls,
        down: opts.shipmentsDown ?? false,
      }),
    });
    await app.ready();
    const db = app.db;
    const inject = app.inject.bind(app);
    const headers = (adminId = me.id) => ({ "x-user-id": adminId, "x-user-roles": "admin" });
    return {
      me,
      user,
      sanctions,
      withdrawCalls,
      headers,
      rows: () => db.auditLog.findMany({ where: { targetId: user.id }, orderBy: { createdAt: "asc" } }),
      suspend: (body: Record<string, unknown> = { type: "suspension", reason: "Reportes reiterados", internalNote: "Ver reportes 12 y 13", endsAt: ENDS_AT }, adminId?: string) =>
        inject({ method: "POST", url: `/admin/users/${user.id}/sanctions`, headers: headers(adminId), payload: body }),
      list: () => inject({ method: "GET", url: `/admin/users/${user.id}/sanctions`, headers: headers() }),
      retry: (sanctionId: string) => inject({ method: "POST", url: `/admin/users/${user.id}/sanctions/${sanctionId}/withdraw`, headers: headers() }),
      lift: (sanctionId: string, adminId?: string) =>
        inject({ method: "POST", url: `/admin/users/${user.id}/sanctions/${sanctionId}/lift`, headers: headers(adminId), payload: { reason: "Revisado" } }),
    };
  }

  const withdrawn = (overrides: Partial<WithdrawOpenActivityResult> = {}): WithdrawOpenActivityResult => ({
    ...emptyWithdrawal(),
    cancelledShipmentIds: [randomUUID(), randomUUID()],
    withdrawnOfferIds: [randomUUID()],
    ...overrides,
  });

  it("sin rol admin responde 403", async () => {
    const t = await setup();
    const res = await app!.inject({
      method: "POST",
      url: `/admin/users/${t.user.id}/sanctions`,
      headers: { "x-user-id": t.me.id, "x-user-roles": "sender" },
      payload: { type: "suspension", reason: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  describe("suspender", () => {
    it("aplica la sanción, después retira con el sanctionId y registra tipo, motivo, nota, plazo y lo retirado", async () => {
      const result = withdrawn();
      const t = await setup({ withdrawResults: [result] });

      const res = await t.suspend();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        type: "suspension",
        reason: "Reportes reiterados",
        internalNote: "Ver reportes 12 y 13",
        endsAt: ENDS_AT,
        appliedBy: t.me.id,
        appliedByName: "Ada Admin",
        withdrawal: { status: "complete", result, errorCode: null },
      });
      expect(t.withdrawCalls).toEqual([{ userId: t.user.id, sanctionId: body.id }]);

      const [row] = await t.rows();
      expect(row).toMatchObject({ action: "user.suspend", outcome: "succeeded", reason: "Reportes reiterados" });
      expect(row?.context).toMatchObject({
        type: "suspension",
        internalNote: "Ver reportes 12 y 13",
        endsAt: ENDS_AT,
        sanctionId: body.id,
        withdrawal: { status: "complete", result },
      });
    });

    it("DoD: si el retiro falla la sanción queda vigente, la bitácora registra el fallo y el reintento sale bien", async () => {
      const result = withdrawn();
      const t = await setup({ withdrawResults: [shipmentsDown(), result] });

      const res = await t.suspend();
      expect(res.statusCode).toBe(201);
      const sanctionId = res.json().id as string;
      expect(res.json().withdrawal).toMatchObject({ status: "failed", result: null, errorCode: "SHIPMENTS_SERVICE_UNAVAILABLE" });

      // La sanción sigue aplicada y la ficha ofrece reintentar.
      const listed = (await t.list()).json().items;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: sanctionId, liftedAt: null, withdrawal: { status: "failed" } });
      const [applyRow] = await t.rows();
      expect(applyRow).toMatchObject({ action: "user.suspend", outcome: "succeeded" });
      expect(applyRow?.context).toMatchObject({ withdrawal: { status: "failed", errorCode: "SHIPMENTS_SERVICE_UNAVAILABLE" } });

      const retried = await t.retry(sanctionId);
      expect(retried.statusCode).toBe(200);
      expect(retried.json()).toMatchObject({ status: "complete", result });

      expect((await t.list()).json().items[0].withdrawal).toMatchObject({ status: "complete", result });
      const rows = await t.rows();
      expect(rows.map((r) => [r.action, r.outcome])).toEqual([
        ["user.suspend", "succeeded"],
        ["user.sanction_withdraw", "succeeded"],
      ]);
      expect(t.withdrawCalls.map((c) => c.sanctionId)).toEqual([sanctionId, sanctionId]);
    });

    it("con `failures` el retiro queda parcial y se puede reintentar", async () => {
      const t = await setup({ withdrawResults: [withdrawn({ failures: [{ kind: "offer", id: randomUUID() }] })] });

      const res = await t.suspend();

      expect(res.statusCode).toBe(201);
      expect(res.json().withdrawal.status).toBe("partial");
      expect((await t.list()).json().items[0].withdrawal.status).toBe("partial");
    });

    it("un reintento con svc-shipments caído responde 502 y la ficha sigue mostrando el retiro como fallido", async () => {
      const t = await setup({ withdrawResults: [withdrawn({ failures: [{ kind: "trip", id: randomUUID() }] }), shipmentsDown()] });
      const sanctionId = (await t.suspend()).json().id as string;

      const retried = await t.retry(sanctionId);

      expect(retried.statusCode).toBe(502);
      expect((await t.list()).json().items[0].withdrawal).toMatchObject({ status: "failed", errorCode: "SHIPMENTS_SERVICE_UNAVAILABLE" });
    });

    it("un admin no puede sancionarse: 403 y nada aplicado", async () => {
      const t = await setup();

      const res = await app!.inject({
        method: "POST",
        url: `/admin/users/${t.me.id}/sanctions`,
        headers: t.headers(),
        payload: { type: "suspension", reason: "Prueba" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
      expect(t.sanctions).toEqual([]);
      expect(t.withdrawCalls).toEqual([]);
    });

    it("un motivo en blanco es 400", async () => {
      const t = await setup();
      const res = await t.suspend({ type: "suspension", reason: "   " });
      expect(res.statusCode).toBe(400);
      expect(t.sanctions).toEqual([]);
    });
  });

  describe("inhabilitar", () => {
    it("DoD: con un envío en tránsito responde 409 con la lista y no aplica nada", async () => {
      const shipment: InProgressShipment = {
        id: randomUUID(),
        shortId: "AB12CD34",
        status: "in_transit",
        userRole: "carrier",
        pickupAddress: "Córdoba",
        deliveryAddress: "Rosario",
      };
      const t = await setup({ inProgress: [shipment] });

      const res = await t.suspend({ type: "disable", reason: "Fraude" });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({ code: "USER_HAS_IN_PROGRESS_SHIPMENTS", details: { shipments: [shipment] } });
      expect(t.sanctions).toEqual([]);
      expect(t.withdrawCalls).toEqual([]);
      const [row] = await t.rows();
      expect(row).toMatchObject({ action: "user.disable", outcome: "failed", errorCode: "USER_HAS_IN_PROGRESS_SHIPMENTS" });
    });

    it("sin envíos en curso inhabilita y retira", async () => {
      const t = await setup({ withdrawResults: [withdrawn()] });

      const res = await t.suspend({ type: "disable", reason: "Fraude", internalNote: "Caso 44" });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ type: "disable", endsAt: null, withdrawal: { status: "complete" } });
      expect((await t.rows())[0]).toMatchObject({ action: "user.disable", outcome: "succeeded" });
    });
  });

  describe("levantar", () => {
    it("levanta la sanción vigente con el nombre de quien la levantó", async () => {
      const t = await setup();
      const sanctionId = (await t.suspend()).json().id as string;

      const res = await t.lift(sanctionId);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: sanctionId, closedCause: "lifted", liftReason: "Revisado", liftedByName: "Ada Admin" });
      expect((await t.rows()).map((r) => r.action)).toEqual(["user.suspend", "user.sanction_lift"]);
    });

    it("una sanción cerrada es 409 y una inexistente 404; tampoco se reintenta el retiro de una cerrada", async () => {
      const t = await setup();
      const sanctionId = (await t.suspend()).json().id as string;
      await t.lift(sanctionId);

      expect((await t.lift(sanctionId)).json().error.code).toBe("SANCTION_ALREADY_CLOSED");
      expect((await t.lift(randomUUID())).json().error.code).toBe("SANCTION_NOT_FOUND");
      expect((await t.retry(sanctionId)).statusCode).toBe(409);
    });

    it("un admin no puede levantar su propia sanción", async () => {
      const t = await setup();
      const own: AccountSanction = {
        id: randomUUID(),
        userId: t.me.id,
        type: "suspension",
        reason: "x",
        internalNote: null,
        startedAt: new Date().toISOString(),
        endsAt: null,
        appliedBy: randomUUID(),
        liftedAt: null,
        liftedBy: null,
        liftReason: null,
        closedCause: null,
      };
      t.sanctions.push(own);

      const res = await app!.inject({
        method: "POST",
        url: `/admin/users/${t.me.id}/sanctions/${own.id}/lift`,
        headers: t.headers(),
        payload: { reason: "Me levanto" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
      expect(own.liftedAt).toBeNull();
    });
  });

  it("la vista previa cuenta lo retirable y los envíos en curso, sin bitácora", async () => {
    const shipment: InProgressShipment = {
      id: randomUUID(),
      shortId: "ZZ11YY22",
      status: "assigned",
      userRole: "sender",
      pickupAddress: "Córdoba",
      deliveryAddress: "Villa María",
    };
    const t = await setup({ inProgress: [shipment] });

    const res = await app!.inject({ method: "GET", url: `/admin/users/${t.user.id}/sanctions/preview`, headers: t.headers() });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shipments: 2, offers: 1, trips: 0, recurringSeries: 1, inProgressShipments: [shipment] });
    expect(await t.rows()).toEqual([]);
  });
});
