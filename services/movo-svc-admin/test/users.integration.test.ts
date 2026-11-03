import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { AdminUserProfile } from "@movo/shared";
import { buildApp } from "../src/app";
import { UNKNOWN_USER_NAME } from "../src/modules/users/users.routes";
import { createFakePaymentsClient, createFakeShipmentsClient, createFakeUsersClient } from "./fake-clients";

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

/**
 * MOVO-294: la base es real (bitácora y notas viven en el schema `admin`); los servicios dueños son
 * fakes, así cada caso puede tirar uno abajo y ver que solo su sección falla (AC3 de MOVO-293).
 * Sin limpiar tablas: la bitácora no admite TRUNCATE y cada caso usa ids aleatorios.
 */
describe("Búsqueda de usuarios, ficha y acciones de soporte (MOVO-294)", () => {
  const me = profile({ fullName: "Ada Admin", roles: [{ role: "admin", grantedAt: "2026-10-01T00:00:00.000Z" }] });
  const user = profile();
  const carrier = profile({ fullName: "Juan Bordino" });
  const deleted = profile({ fullName: "Usuario eliminado", accountStatus: "deleted", deletedAt: "2026-10-17T00:00:00.000Z" });
  const ghostId = randomUUID();
  const profiles = [me, user, carrier, deleted];

  const shipmentId = randomUUID();
  const shipmentsData = {
    userShipments: {
      [user.id]: {
        items: [
          {
            id: shipmentId,
            shortId: shipmentId.slice(0, 8).toUpperCase(),
            status: "in_transit" as const,
            pickupAddress: "Córdoba",
            deliveryAddress: "Rosario",
            priceArs: 6000,
            createdAt: "2026-10-10T00:00:00.000Z",
            userRole: "sender" as const,
            senderId: user.id,
            carrierId: carrier.id,
            receiverId: ghostId,
          },
        ],
        page: 1,
        pageSize: 5,
        total: 1,
        counts: { sender: 1, carrier: 0, receiver: 0 },
      },
    },
    userRatings: {
      [user.id]: {
        average: 4.5,
        count: 1,
        items: [{ score: 5, comment: "Excelente", raterId: carrier.id, roleOfRated: "sender" as const, shipmentId, createdAt: "2026-10-11T00:00:00.000Z" }],
        page: 1,
        pageSize: 5,
      },
    },
  };

  const headers = (adminId = me.id) => ({ "x-user-id": adminId, "x-user-roles": "admin" });
  const rowsFor = (targetId: string) => app.db.auditLog.findMany({ where: { targetId }, orderBy: { createdAt: "asc" } });

  let app: FastifyInstance;
  /** El fake de pagos del `app` principal (cada `build()` arma uno nuevo). */
  let payments: ReturnType<typeof createFakePaymentsClient>;

  function build(opts: { shipmentsDown?: boolean; usersDown?: boolean; namesDown?: boolean; paymentsDown?: boolean } = {}) {
    const fakePayments = createFakePaymentsClient({
      down: opts.paymentsDown ?? false,
      ledgers: {
        [user.id]: {
          balanceArs: 150,
          items: [
            { id: randomUUID(), type: "manual_adjustment", amountArs: 150, status: "pending", shipmentId: null, reason: "Compensación", adminId: me.id, createdAt: "2026-10-12T00:00:00.000Z" },
          ],
          nextCursor: null,
        },
      },
    });
    const built = buildApp({
      usersClient: createFakeUsersClient({ profiles, down: opts.usersDown ?? false, namesDown: opts.namesDown ?? false }),
      shipmentsClient: createFakeShipmentsClient({ ...shipmentsData, down: opts.shipmentsDown ?? false }),
      paymentsClient: fakePayments.client,
    });
    return Object.assign(built, { fakePayments });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    const built = build();
    payments = built.fakePayments;
    app = built;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("lecturas", () => {
    it("sin rol admin responde 403", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/users", headers: { "x-user-id": randomUUID(), "x-user-roles": "sender" } });
      expect(res.statusCode).toBe(403);
    });

    it("busca y pagina", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/users?q=ana&pageSize=10", headers: headers() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ page: 1, pageSize: 10, total: 1, items: [{ id: user.id, matchedBy: "name" }] });

      const invalid = await app.inject({ method: "GET", url: "/admin/users?pageSize=51", headers: headers() });
      expect(invalid.statusCode).toBe(400);
    });

    it("la ficha devuelve el perfil completo, también de una cuenta dada de baja; inexistente es 404", async () => {
      const res = await app.inject({ method: "GET", url: `/admin/users/${user.id}`, headers: headers() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(user);

      expect((await app.inject({ method: "GET", url: `/admin/users/${deleted.id}`, headers: headers() })).json().deletedAt).toBe(deleted.deletedAt);

      const missing = await app.inject({ method: "GET", url: `/admin/users/${randomUUID()}`, headers: headers() });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe("USER_NOT_FOUND");
    });

    it("KYC suma la tarjeta de Mercado Pago de svc-payments", async () => {
      const res = await app.inject({ method: "GET", url: `/admin/users/${user.id}/kyc`, headers: headers() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        identity: { status: "approved" },
        license: { status: "not_started", expiresAt: null },
        mercadoPago: { status: "not_linked" },
      });
    });

    it("los envíos traen el nombre de cada parte; un id que svc-users no conoce queda con el nombre por defecto", async () => {
      const res = await app.inject({ method: "GET", url: `/admin/users/${user.id}/shipments?role=sender`, headers: headers() });
      expect(res.statusCode).toBe(200);
      const [item] = res.json().items;
      expect(item).toMatchObject({
        id: shipmentId,
        sender: { id: user.id, fullName: "Ana Ariza" },
        carrier: { id: carrier.id, fullName: "Juan Bordino" },
        receiver: { id: ghostId, fullName: UNKNOWN_USER_NAME },
      });
      expect(item).not.toHaveProperty("senderId");
      expect(res.json().counts).toEqual({ sender: 1, carrier: 0, receiver: 0 });
    });

    it("las calificaciones traen el nombre de quien calificó", async () => {
      const res = await app.inject({ method: "GET", url: `/admin/users/${user.id}/ratings`, headers: headers() });
      expect(res.json()).toMatchObject({ average: 4.5, count: 1, items: [{ score: 5, rater: { id: carrier.id, fullName: "Juan Bordino" } }] });
    });

    it("la cuenta corriente trae el nombre del admin del ajuste y el saldo total", async () => {
      const res = await app.inject({ method: "GET", url: `/admin/users/${user.id}/ledger`, headers: headers() });
      expect(res.json()).toMatchObject({ balanceArs: 150, items: [{ type: "manual_adjustment", reason: "Compensación", adminName: "Ada Admin" }], nextCursor: null });
    });

    it("viajes, vehículo, moderación, dispositivos y sanciones responden su forma", async () => {
      for (const [section, expected] of [
        ["trips", { items: [], total: 0 }],
        ["vehicle", { vehicle: null }],
        ["moderation", { totals: { reportsReceived: 0, reportsMade: 0, blocksMade: 0, blocksReceived: 0 } }],
        ["devices", { devices: [], handshakeKey: null }],
        ["sanctions", { items: [] }],
      ] as const) {
        const res = await app.inject({ method: "GET", url: `/admin/users/${user.id}/${section}`, headers: headers() });
        expect(res.statusCode, section).toBe(200);
        expect(res.json(), section).toMatchObject(expected);
      }
    });

    it("las lecturas no dejan filas en la bitácora", async () => {
      await app.inject({ method: "GET", url: `/admin/users/${carrier.id}`, headers: headers() });
      expect(await rowsFor(carrier.id)).toEqual([]);
    });
  });

  describe("cada sección falla sola (AC3 de MOVO-293)", () => {
    it("con svc-shipments caído, /:id responde igual y /shipments, /trips y /ratings son 502", async () => {
      const down = build({ shipmentsDown: true });
      await down.ready();
      try {
        expect((await down.inject({ method: "GET", url: `/admin/users/${user.id}`, headers: headers() })).statusCode).toBe(200);
        for (const section of ["shipments", "trips", "ratings"]) {
          const res = await down.inject({ method: "GET", url: `/admin/users/${user.id}/${section}`, headers: headers() });
          expect(res.statusCode, section).toBe(502);
          expect(res.json().error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
        }
        expect((await down.inject({ method: "GET", url: `/admin/users/${user.id}/ledger`, headers: headers() })).statusCode).toBe(200);
      } finally {
        await down.close();
      }
    });

    it("con svc-payments caído, /ledger es 502 y /kyc responde con mercadoPago en null", async () => {
      const down = build({ paymentsDown: true });
      await down.ready();
      try {
        const ledger = await down.inject({ method: "GET", url: `/admin/users/${user.id}/ledger`, headers: headers() });
        expect(ledger.statusCode).toBe(502);
        expect(ledger.json().error.code).toBe("PAYMENTS_SERVICE_UNAVAILABLE");

        const kyc = await down.inject({ method: "GET", url: `/admin/users/${user.id}/kyc`, headers: headers() });
        expect(kyc.statusCode).toBe(200);
        expect(kyc.json()).toMatchObject({ identity: { status: "approved" }, mercadoPago: null });
        expect((await down.inject({ method: "GET", url: `/admin/users/${user.id}/shipments`, headers: headers() })).statusCode).toBe(200);
      } finally {
        await down.close();
      }
    });

    it("si solo falla la resolución de nombres, los envíos responden con el nombre por defecto", async () => {
      const degraded = build({ namesDown: true });
      await degraded.ready();
      try {
        const res = await degraded.inject({ method: "GET", url: `/admin/users/${user.id}/shipments`, headers: headers() });
        expect(res.statusCode).toBe(200);
        expect(res.json().items[0].carrier.fullName).toBe(UNKNOWN_USER_NAME);
      } finally {
        await degraded.close();
      }
    });
  });

  describe("acciones de soporte", () => {
    it("cerrar sesiones deja la fila con el motivo y aparece en la bitácora del usuario con el nombre del admin", async () => {
      const target = profile();
      profiles.push(target);
      const res = await app.inject({
        method: "POST",
        url: `/admin/users/${target.id}/sessions/revoke`,
        headers: headers(),
        payload: { reason: "Pidió cerrar sesión en un teléfono perdido" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ revokedRefreshTokens: 2 });

      const audit = await app.inject({ method: "GET", url: `/admin/users/${target.id}/audit-log`, headers: headers() });
      expect(audit.json().items).toEqual([
        expect.objectContaining({
          action: "user.sessions_revoke",
          outcome: "succeeded",
          adminName: "Ada Admin",
          reason: "Pidió cerrar sesión en un teléfono perdido",
        }),
      ]);
    });

    it("sobre la propia cuenta es 403 ADMIN_CONFLICT_OF_INTEREST y queda como failed", async () => {
      const res = await app.inject({ method: "POST", url: `/admin/users/${me.id}/sessions/revoke`, headers: headers(), payload: { reason: "Prueba" } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("ADMIN_CONFLICT_OF_INTEREST");
      const rows = await app.db.auditLog.findMany({ where: { targetId: me.id, action: "user.sessions_revoke" } });
      expect(rows.at(-1)).toMatchObject({ outcome: "failed", errorCode: "ADMIN_CONFLICT_OF_INTEREST" });
    });

    it("un motivo vacío o solo espacios es 400 y no deja fila", async () => {
      const target = profile();
      for (const reason of ["", "   "]) {
        const res = await app.inject({ method: "POST", url: `/admin/users/${target.id}/sessions/revoke`, headers: headers(), payload: { reason } });
        expect(res.statusCode).toBe(400);
      }
      expect(await rowsFor(target.id)).toEqual([]);
    });

    it("cambiar el contacto deja en la bitácora el valor anterior y el nuevo, y no expone noticeFailed", async () => {
      const target = profile({ email: "viejo@movo.test" });
      profiles.push(target);
      const res = await app.inject({
        method: "POST",
        url: `/admin/users/${target.id}/contact`,
        headers: headers(),
        payload: { field: "email", newValue: "nuevo@movo.test", expectedCurrent: "viejo@movo.test", reason: "Lo pidió por soporte" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ email: "nuevo@movo.test", emailVerified: false, phone: target.phone, phoneVerified: true, revokedRefreshTokens: 1 });

      const [row] = await rowsFor(target.id);
      expect(row).toMatchObject({ action: "user.contact_update", outcome: "succeeded", reason: "Lo pidió por soporte" });
      // Enmascarados: la bitácora no se puede editar y sobrevive a la baja de la cuenta.
      expect(row?.context).toEqual({ field: "email", previous: "v***o@movo.test", next: "n***o@movo.test", noticeFailed: false, sessionsRevokeFailed: false });
    });

    it("un CONTACT_CHANGED de svc-users se relanza y queda como failed", async () => {
      const target = profile();
      profiles.push(target);
      const res = await app.inject({
        method: "POST",
        url: `/admin/users/${target.id}/contact`,
        headers: headers(),
        payload: { field: "email", newValue: "nuevo2@movo.test", expectedCurrent: "otro@movo.test", reason: "Soporte" },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CONTACT_CHANGED");
      expect((await rowsFor(target.id))[0]).toMatchObject({ outcome: "failed", errorCode: "CONTACT_CHANGED" });
    });

    it("el ajuste de saldo es idempotente: la misma key dos veces es un solo movimiento", async () => {
      const target = profile();
      profiles.push(target);
      const payload = { amountArs: 250.5, reason: "Compensación por demora", idempotencyKey: randomUUID() };
      const first = await app.inject({ method: "POST", url: `/admin/users/${target.id}/ledger/adjustments`, headers: headers(), payload });
      const retry = await app.inject({ method: "POST", url: `/admin/users/${target.id}/ledger/adjustments`, headers: headers(), payload });

      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ balanceArs: 250.5, entry: { type: "manual_adjustment", amountArs: 250.5, adminName: "Ada Admin", reason: "Compensación por demora" } });
      expect(retry.json().entry.id).toBe(first.json().entry.id);
      expect(payments.adjustments.size).toBe(1);
      expect([...payments.adjustments.keys()]).toEqual([`admin-adjustment:${payload.idempotencyKey}`]);

      const rows = await rowsFor(target.id);
      // El reintento deja su fila, marcada como repetida: no aparenta un segundo ajuste.
      expect(rows.map((r) => [r.action, r.outcome, (r.context as { repeated?: boolean } | null)?.repeated])).toEqual([
        ["user.ledger_adjust", "succeeded", false],
        ["user.ledger_adjust", "succeeded", true],
      ]);
    });

    it("el ajuste sobre una cuenta dada de baja es 409 USER_DELETED y no llega a svc-payments", async () => {
      const before = payments.adjustments.size;
      const res = await app.inject({
        method: "POST",
        url: `/admin/users/${deleted.id}/ledger/adjustments`,
        headers: headers(),
        payload: { amountArs: 10, reason: "Prueba", idempotencyKey: randomUUID() },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("USER_DELETED");
      expect(payments.adjustments.size).toBe(before);
      expect((await rowsFor(deleted.id)).at(-1)).toMatchObject({ outcome: "failed", errorCode: "USER_DELETED" });
    });

    it("el 422 AMOUNT_OUT_OF_RANGE de svc-payments se relanza", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/admin/users/${user.id}/ledger/adjustments`,
        headers: headers(),
        payload: { amountArs: 0, reason: "Prueba", idempotencyKey: randomUUID() },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("AMOUNT_OUT_OF_RANGE");
    });

    it("con svc-payments caído el ajuste es 502 y la fila queda unknown (pudo haberse aplicado)", async () => {
      const target = profile();
      profiles.push(target);
      const down = build({ paymentsDown: true });
      await down.ready();
      try {
        const res = await down.inject({
          method: "POST",
          url: `/admin/users/${target.id}/ledger/adjustments`,
          headers: headers(),
          payload: { amountArs: 10, reason: "Prueba", idempotencyKey: randomUUID() },
        });
        expect(res.statusCode).toBe(502);
        expect((await rowsFor(target.id))[0]).toMatchObject({ outcome: "unknown", errorCode: "PAYMENTS_SERVICE_UNAVAILABLE" });
      } finally {
        await down.close();
      }
    });

    it("con svc-users caído cerrar sesiones es 502 y la fila queda unknown", async () => {
      const target = profile();
      const down = build({ usersDown: true });
      await down.ready();
      try {
        const res = await down.inject({ method: "POST", url: `/admin/users/${target.id}/sessions/revoke`, headers: headers(), payload: { reason: "Prueba" } });
        expect(res.statusCode).toBe(502);
        expect((await rowsFor(target.id))[0]).toMatchObject({ outcome: "unknown", errorCode: "USERS_SERVICE_UNAVAILABLE" });
      } finally {
        await down.close();
      }
    });

    it("las notas se agregan (también sobre una cuenta dada de baja), se listan de la más nueva a la más vieja y paginan", async () => {
      for (const body of ["Primera nota", "Segunda nota", "Tercera nota"]) {
        const res = await app.inject({ method: "POST", url: `/admin/users/${deleted.id}/notes`, headers: headers(), payload: { body } });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toMatchObject({ body, adminId: me.id, adminName: "Ada Admin" });
      }

      const first = await app.inject({ method: "GET", url: `/admin/users/${deleted.id}/notes?limit=2`, headers: headers() });
      expect(first.json().items.map((n: { body: string }) => n.body)).toEqual(["Tercera nota", "Segunda nota"]);
      const second = await app.inject({ method: "GET", url: `/admin/users/${deleted.id}/notes?limit=2&cursor=${first.json().nextCursor}`, headers: headers() });
      expect(second.json()).toMatchObject({ items: [{ body: "Primera nota" }], nextCursor: null });

      const rows = await app.db.auditLog.findMany({ where: { targetId: deleted.id, action: "user.note_add" } });
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.outcome === "succeeded")).toBe(true);
    });

    it("una nota vacía es 400; sobre un usuario inexistente es 404; sobre uno mismo es 403", async () => {
      expect((await app.inject({ method: "POST", url: `/admin/users/${user.id}/notes`, headers: headers(), payload: { body: "  " } })).statusCode).toBe(400);
      const missing = await app.inject({ method: "POST", url: `/admin/users/${randomUUID()}/notes`, headers: headers(), payload: { body: "Hola" } });
      expect(missing.statusCode).toBe(404);
      const self = await app.inject({ method: "POST", url: `/admin/users/${me.id}/notes`, headers: headers(), payload: { body: "Hola" } });
      expect(self.statusCode).toBe(403);
    });

    it("una nota no se puede editar ni borrar en la base", async () => {
      const res = await app.inject({ method: "POST", url: `/admin/users/${user.id}/notes`, headers: headers(), payload: { body: "Inmutable" } });
      const id = res.json().id as string;
      await expect(app.db.adminUserNote.update({ where: { id }, data: { body: "Cambiada" } })).rejects.toThrow();
      await expect(app.db.adminUserNote.delete({ where: { id } })).rejects.toThrow();
    });
  });
});
