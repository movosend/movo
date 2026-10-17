import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

// Integración contra Postgres real (convención del repo): la inmutabilidad la imponen triggers
// de la migración, así que no se puede mockear la base.

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("cuenta corriente del usuario (MOVO-309)", () => {
  let app: FastifyInstance;
  let seq = 0;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Los triggers bloquean DELETE pero no TRUNCATE.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.user_ledger_entries CASCADE");
  });

  function addEntry(userId: string, body: Record<string, unknown>) {
    seq += 1;
    return app.inject({
      method: "POST",
      url: `/internal/payments/users/${userId}/ledger-entries`,
      payload: { idempotencyKey: `test-key-${seq}`, type: "cancellation_penalty", amountArs: 100, ...body },
    });
  }

  async function balanceOf(userId: string) {
    const res = await app.inject({ method: "GET", url: `/internal/payments/users/${userId}/balance` });
    expect(res.statusCode).toBe(200);
    return res.json() as { balanceArs: number; oldestUnpaidAt: string | null };
  }

  describe("saldo", () => {
    it("un usuario sin movimientos tiene saldo 0 y ninguna deuda", async () => {
      expect(await balanceOf(USER)).toEqual({ balanceArs: 0, oldestUnpaidAt: null });
    });

    it("suma con signo los movimientos y calcula la deuda más vieja", async () => {
      const first = (await addEntry(USER, { amountArs: 300.5, shipmentId: SHIPMENT })).json().entry;
      await addEntry(USER, { type: "voluntary_payment", amountArs: -100.25 });

      const balance = await balanceOf(USER);
      expect(balance.balanceArs).toBe(200.25);
      expect(balance.oldestUnpaidAt).toBe(first.createdAt);
    });

    it("ignora los movimientos anulados", async () => {
      await addEntry(USER, { amountArs: 100 });
      const voided = (await addEntry(USER, { amountArs: 500 })).json().entry;
      await app.userLedger.transition(USER, voided.id, "pending", "voided");

      expect((await balanceOf(USER)).balanceArs).toBe(100);
    });

    it("admite saldo a favor (negativo) y entonces no hay deuda vencible", async () => {
      await addEntry(USER, { amountArs: 100 });
      await addEntry(USER, { type: "voluntary_payment", amountArs: -350 });

      expect(await balanceOf(USER)).toEqual({ balanceArs: -250, oldestUnpaidAt: null });
    });

    it("una deuda saldada deja de ser la más vieja sin pagar", async () => {
      const old = (await addEntry(USER, { amountArs: 100 })).json().entry;
      const recent = (await addEntry(USER, { amountArs: 50 })).json().entry;
      await app.userLedger.transition(USER, old.id, "pending", "settled");

      const balance = await balanceOf(USER);
      expect(balance.balanceArs).toBe(150); // settled sigue contando: lo salda un movimiento negativo aparte
      expect(balance.oldestUnpaidAt).toBe(recent.createdAt);
    });

    it("una penalidad compensada pero sin pasar a settled no figura como la deuda vieja", async () => {
      const paid = (await addEntry(USER, { amountArs: 100 })).json().entry;
      await addEntry(USER, { type: "penalty_capture", amountArs: -100, status: "settled" });
      expect(await balanceOf(USER)).toEqual({ balanceArs: 0, oldestUnpaidAt: null });

      const fresh = (await addEntry(USER, { amountArs: 50 })).json().entry;

      const balance = await balanceOf(USER);
      expect(balance.balanceArs).toBe(50);
      expect(balance.oldestUnpaidAt).toBe(fresh.createdAt);
      expect(balance.oldestUnpaidAt).not.toBe(paid.createdAt);
    });

    it("no mezcla usuarios", async () => {
      await addEntry(USER, { amountArs: 100 });
      await addEntry(OTHER_USER, { amountArs: 40 });

      expect((await balanceOf(USER)).balanceArs).toBe(100);
      expect((await balanceOf(OTHER_USER)).balanceArs).toBe(40);
    });
  });

  describe("alta idempotente", () => {
    it("201 al crear y 200 con el mismo movimiento al reintentar, sin duplicar", async () => {
      const body = { idempotencyKey: "penalty-ship-1", amountArs: 250, shipmentId: SHIPMENT, roleAtOrigin: "carrier" };
      const first = await addEntry(USER, body);
      const second = await addEntry(USER, body);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(200);
      expect(second.json().created).toBe(false);
      expect(second.json().entry.id).toBe(first.json().entry.id);
      expect((await balanceOf(USER)).balanceArs).toBe(250);
    });

    it("409 si la key se reusa con otro monto, y no cambia el saldo", async () => {
      await addEntry(USER, { idempotencyKey: "penalty-ship-2", amountArs: 250 });
      const res = await addEntry(USER, { idempotencyKey: "penalty-ship-2", amountArs: 999 });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("LEDGER_IDEMPOTENCY_CONFLICT");
      expect((await balanceOf(USER)).balanceArs).toBe(250);
    });

    it("dos altas simultáneas con la misma key terminan con una sola fila", async () => {
      const body = { idempotencyKey: "penalty-race-1", amountArs: 75 };
      const results = await Promise.all([addEntry(USER, body), addEntry(USER, body), addEntry(USER, body)]);

      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
      expect((await balanceOf(USER)).balanceArs).toBe(75);
    });

    it("404 HOLD_NOT_FOUND si el holdId no existe en la base", async () => {
      const res = await addEntry(USER, { holdId: "99999999-9999-4999-8999-999999999999" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("HOLD_NOT_FOUND");
    });

    it("asocia el holdId si existe en la base", async () => {
      const hold = await app.db.hold.create({
        data: {
          shipmentId: randomUUID(),
          attempt: seq + 1,
          carrierId: OTHER_USER,
          collectorId: "1000000001",
          mpPaymentId: `test-mp-${seq}`,
          amountArs: 1000,
          applicationFeeArs: 150,
          baseAmountArs: 1000,
          commissionArs: 150,
          status: "authorized",
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const res = await addEntry(USER, { holdId: hold.id });
      expect(res.statusCode).toBe(201);
      expect(res.json().entry.holdId).toBe(hold.id);
    });

    it.each([
      ["cero", { amountArs: 0 }],
      ["más de 2 decimales", { amountArs: 10.123 }],
      ["medio centavo en el tope", { amountArs: 9999999.995 }],
      ["más de 10M", { amountArs: 10000001 }],
      ["menos de -10M", { amountArs: -10000001 }],
      ["tipo inválido", { type: "bonus" }],
      ["tipo manual_adjustment (va por su endpoint)", { type: "manual_adjustment" }],
    ])("400 con %s", async (_name, patch) => {
      const res = await addEntry(USER, patch);
      expect(res.statusCode).toBe(400);
    });
  });

  describe("ajuste manual", () => {
    function adjust(body: Record<string, unknown>) {
      seq += 1;
      return app.inject({
        method: "POST",
        url: `/internal/payments/users/${USER}/manual-adjustments`,
        payload: { idempotencyKey: `adjust-key-${seq}`, amountArs: -80, adminId: ADMIN, reason: "Penalidad aplicada por error", ...body },
      });
    }

    it("registra el motivo y entra al saldo", async () => {
      await addEntry(USER, { amountArs: 100 });
      const res = await adjust({});

      expect(res.statusCode).toBe(201);
      expect(res.json().entry).toMatchObject({ type: "manual_adjustment", amountArs: -80, reason: "Penalidad aplicada por error" });
      expect((await balanceOf(USER)).balanceArs).toBe(20);
    });

    it("exige motivo (400 si falta o es solo espacios)", async () => {
      expect((await adjust({ reason: undefined })).statusCode).toBe(400);
      expect((await adjust({ reason: "   " })).statusCode).toBe(400);
    });

    it("la base también lo exige, aunque se inserte por SQL directo", async () => {
      await expect(
        app.db.$executeRawUnsafe(
          `INSERT INTO payments.user_ledger_entries (user_id, type, amount_ars, idempotency_key, request_fingerprint)
           VALUES ('${USER}', 'manual_adjustment', 10, 'sql-directo', 'x')`
        )
      ).rejects.toThrow();
    });
  });

  describe("solo inserción", () => {
    it("no se puede borrar un movimiento", async () => {
      await addEntry(USER, { amountArs: 100 });
      await expect(app.db.$executeRawUnsafe("DELETE FROM payments.user_ledger_entries")).rejects.toThrow(/solo de inserción|solo inserción/);
    });

    it("no se puede editar el monto, pero sí el estado", async () => {
      const entry = (await addEntry(USER, { amountArs: 100 })).json().entry;

      await expect(
        app.db.$executeRawUnsafe(`UPDATE payments.user_ledger_entries SET amount_ars = 1 WHERE id = '${entry.id}'`)
      ).rejects.toThrow(/solo puede cambiar status/);
      await expect(
        app.userLedger.transition(USER, entry.id, "pending", "reserved")
      ).resolves.toMatchObject({ status: "reserved", amountArs: 100 });
    });

    it("voided es terminal y de settled solo se sale anulando", async () => {
      const entry = (await addEntry(USER, { amountArs: 100 })).json().entry;
      await app.userLedger.transition(USER, entry.id, "pending", "settled");

      await expect(app.userLedger.transition(USER, entry.id, "settled", "pending")).rejects.toMatchObject({
        statusCode: 409,
        code: "LEDGER_INVALID_TRANSITION",
      });
      await app.userLedger.transition(USER, entry.id, "settled", "voided");
      await expect(app.userLedger.transition(USER, entry.id, "voided", "pending")).rejects.toMatchObject({
        code: "LEDGER_INVALID_TRANSITION",
      });
      await expect(app.userLedger.transition(USER, entry.id, "voided", "reserved")).rejects.toMatchObject({
        code: "LEDGER_INVALID_TRANSITION",
      });
      await expect(app.userLedger.transition(USER, entry.id, "voided", "settled")).rejects.toMatchObject({
        code: "LEDGER_INVALID_TRANSITION",
      });
    });

    it("la base también rechaza reabrir un movimiento anulado", async () => {
      const entry = (await addEntry(USER, { amountArs: 100 })).json().entry;
      await app.userLedger.transition(USER, entry.id, "pending", "voided");

      await expect(
        app.db.$executeRawUnsafe(`UPDATE payments.user_ledger_entries SET status = 'pending' WHERE id = '${entry.id}'`)
      ).rejects.toThrow(/transición de status no permitida/);
      await expect(
        app.db.$executeRawUnsafe(`UPDATE payments.user_ledger_entries SET status = 'reserved' WHERE id = '${entry.id}'`)
      ).rejects.toThrow(/transición de status no permitida/);
      await expect(
        app.db.$executeRawUnsafe(`UPDATE payments.user_ledger_entries SET status = 'settled' WHERE id = '${entry.id}'`)
      ).rejects.toThrow(/transición de status no permitida/);
    });

    it("una transición con el estado esperado equivocado es 409 y un movimiento ajeno 404", async () => {
      const entry = (await addEntry(USER, { amountArs: 100 })).json().entry;

      await expect(app.userLedger.transition(USER, entry.id, "reserved", "settled")).rejects.toMatchObject({
        statusCode: 409,
        code: "LEDGER_ENTRY_STATE_CONFLICT",
      });
      await expect(app.userLedger.transition(OTHER_USER, entry.id, "pending", "settled")).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe("GET /payments/balance", () => {
    function mine(userId: string, query = "") {
      return app.inject({ method: "GET", url: `/payments/balance${query}`, headers: { "x-user-id": userId } });
    }

    it("401 sin x-user-id", async () => {
      expect((await app.inject({ method: "GET", url: "/payments/balance" })).statusCode).toBe(401);
    });

    it("devuelve saldo y movimientos con el rol y el envío de origen, solo del usuario", async () => {
      await addEntry(USER, { amountArs: 120, shipmentId: SHIPMENT, roleAtOrigin: "carrier" });
      await addEntry(OTHER_USER, { amountArs: 999 });

      const res = await mine(USER);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.balanceArs).toBe(120);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({ roleAtOrigin: "carrier", shipmentId: SHIPMENT, amountArs: 120, type: "cancellation_penalty" });
      expect(body.nextCursor).toBeNull();
    });

    it("pagina por cursor sin repetir ni saltear movimientos, más nuevos primero", async () => {
      for (let i = 1; i <= 5; i += 1) await addEntry(USER, { amountArs: i });
      // El orden de referencia es el de la consulta sin paginar: dos altas en el mismo
      // milisegundo se desempatan por id, no por orden de creación.
      const all = (await mine(USER, "?limit=50")).json().items.map((i: { id: string }) => i.id);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await mine(USER, `?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
        const body = res.json();
        seen.push(...body.items.map((i: { id: string }) => i.id));
        cursor = body.nextCursor;
        pages += 1;
        // El saldo es el total, no el de la página.
        expect(body.balanceArs).toBe(15);
      } while (cursor);

      expect(pages).toBe(3);
      expect(all).toHaveLength(5);
      expect(seen).toEqual(all);
    });

    it("400 con un cursor inválido", async () => {
      expect((await mine(USER, "?cursor=basura")).statusCode).toBe(400);
    });

    it("no expone el reason de un ajuste manual al usuario (lo devuelve como null)", async () => {
      await app.inject({
        method: "POST",
        url: `/internal/payments/users/${USER}/manual-adjustments`,
        payload: {
          idempotencyKey: `priv-adjust-${seq++}`,
          amountArs: -50,
          adminId: ADMIN,
          reason: "Nota confidencial del admin: sospecha de fraude",
        },
      });

      const res = await mine(USER);
      expect(res.statusCode).toBe(200);
      const adjustment = res.json().items.find((i: { type: string }) => i.type === "manual_adjustment");
      expect(adjustment).toBeDefined();
      expect(adjustment.reason).toBeNull();
    });
  });
});
