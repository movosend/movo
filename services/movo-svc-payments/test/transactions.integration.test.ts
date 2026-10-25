import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

// Integración contra Postgres y Redis reales (convención del repo). Las filas se insertan
// directo: el historial solo lee `holds`, `settlements` y `payment_provider_events`.

const SENDER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let seq = 0;
function uuid(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

type SeededHold = { id: string; shipmentId: string; mpPaymentId: string | null };

describe("/payments/transactions (MOVO-303)", () => {
  let app: FastifyInstance;

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
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.settlements, payments.payment_provider_events, payments.holds, payments.balance_payment_attempts, payments.saved_cards CASCADE"
    );
    seq = 0;
  });

  const as = (userId: string) => ({ "x-user-id": userId });
  const list = (query: string, userId = SENDER) =>
    app.inject({ method: "GET", url: `/payments/transactions?${query}`, headers: as(userId) });
  const detail = (id: string, role: string, userId: string) =>
    app.inject({ method: "GET", url: `/payments/transactions/${id}?role=${role}`, headers: as(userId) });

  async function createHold(
    overrides: {
      status?: "creating" | "in_process" | "authorized" | "captured" | "cancelled" | "rejected";
      payerId?: string | null;
      carrierId?: string;
      createdAt?: Date;
      mpPaymentId?: string | null;
      cardBrand?: string | null;
      cardLast4?: string | null;
    } = {}
  ) {
    const shipmentId = uuid();
    return app.db.hold.create({
      data: {
        shipmentId,
        attempt: 1,
        carrierId: overrides.carrierId ?? CARRIER,
        collectorId: "mp-collector",
        mpPaymentId: overrides.mpPaymentId === undefined ? `mp-${shipmentId}` : overrides.mpPaymentId,
        amountArs: 1150,
        applicationFeeArs: 150,
        baseAmountArs: 1150,
        commissionArs: 150,
        status: overrides.status ?? "authorized",
        payerId: overrides.payerId === undefined ? SENDER : overrides.payerId,
        cardBrand: overrides.cardBrand === undefined ? "visa" : overrides.cardBrand,
        cardLast4: overrides.cardLast4 === undefined ? "3764" : overrides.cardLast4,
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
  }

  function settle(hold: SeededHold, status: "processing" | "credited") {
    return app.db.settlement.create({
      data: {
        shipmentId: hold.shipmentId,
        holdId: hold.id,
        carrierId: CARRIER,
        mpPaymentId: hold.mpPaymentId as string,
        grossAmountArs: 1150,
        commissionArs: 150,
        mpFeeArs: status === "credited" ? 47.15 : null,
        // Lo que fija la captura (sin deuda del emisor, igual al bruto y al fee de MP).
        carrierGrossAmountArs: status === "credited" ? 1150 : null,
        carrierMpFeeArs: status === "credited" ? 47.15 : null,
        netAmountArs: status === "credited" ? 952.85 : null,
        status,
        capturedAt: status === "credited" ? new Date("2026-10-10T15:00:00Z") : null,
      },
    });
  }

  function event(
    hold: SeededHold,
    kind: "refund" | "chargeback" | "mediation",
    mpStatus: string,
    amountArs: number | null = null,
    createdAt?: Date
  ) {
    return app.db.paymentProviderEvent.create({
      data: {
        holdId: hold.id,
        shipmentId: hold.shipmentId,
        mpPaymentId: hold.mpPaymentId as string,
        kind,
        mpStatus,
        amountArs,
        holdStatus: "captured",
        ...(createdAt ? { createdAt } : {}),
      },
    });
  }

  it("exige x-user-id", async () => {
    const res = await app.inject({ method: "GET", url: "/payments/transactions?role=sender" });
    expect(res.statusCode).toBe(401);
  });

  it("role es obligatorio y valida sus valores", async () => {
    expect((await list("")).statusCode).toBe(400);
    expect((await list("role=admin")).statusCode).toBe(400);
  });

  describe("visibilidad y rol (AC2, AC8)", () => {
    it("separa emisor y transportista y oculta creating, rejected y cancelados sin pago", async () => {
      await createHold({ status: "authorized" });
      await createHold({ status: "creating", mpPaymentId: null });
      await createHold({ status: "rejected", mpPaymentId: null });
      await createHold({ status: "cancelled", mpPaymentId: null });
      await createHold({ status: "cancelled" }); // released
      await createHold({ status: "authorized", payerId: OTHER });
      await createHold({ status: "authorized", payerId: null });

      const sender = await list("role=sender");
      expect(sender.statusCode).toBe(200);
      expect(sender.json().items.map((i: { status: string }) => i.status).sort()).toEqual(["released", "reserved"]);

      // Visibles para el transportista: los 4 holds que llegaron a MP (2 del emisor + otros 2).
      const asCarrier = await list("role=carrier", CARRIER);
      expect(asCarrier.json().items).toHaveLength(4);
      // El transportista no es pagador de nada: cada lado se ve por separado.
      expect((await list("role=sender", CARRIER)).json().items).toHaveLength(0);
    });

    it("el ítem trae la tarjeta solo para el emisor", async () => {
      await createHold();
      const sender = (await list("role=sender")).json().items[0];
      expect(sender.card).toEqual({ brand: "visa", last4: "3764", alias: null, issuerName: null, paymentType: null });
      expect(sender.refundedAmountArs).toBeNull();
      const carrier = (await list("role=carrier", CARRIER)).json().items[0];
      expect("card" in carrier).toBe(false);
    });

    it("un hold sin datos de tarjeta devuelve card null", async () => {
      await createHold({ cardBrand: null, cardLast4: null });
      expect((await list("role=sender")).json().items[0].card).toBeNull();
    });
  });

  describe("filtro por envío (MOVO-308)", () => {
    it("devuelve solo las transacciones del envío, y nunca las de otro emisor", async () => {
      const mine = await createHold({ status: "cancelled" });
      await createHold();
      const items = (await list(`role=sender&shipmentId=${mine.shipmentId}`)).json().items;
      expect(items.map((t: { id: string }) => t.id)).toEqual([mine.id]);
      expect(items[0].card).toMatchObject({ brand: "visa", last4: "3764" });
      expect((await list(`role=sender&shipmentId=${mine.shipmentId}`, OTHER)).json().items).toEqual([]);
    });

    it("rechaza un shipmentId que no es UUID", async () => {
      expect((await list("role=sender&shipmentId=abc")).statusCode).toBe(400);
    });
  });

  describe("estados (AC6, AC7, AC9)", () => {
    async function seedAllStatuses() {
      const reserved = await createHold({ status: "authorized" });
      const capturedPending = await createHold({ status: "captured" });
      await settle(capturedPending, "processing");
      const completed = await createHold({ status: "captured" });
      await settle(completed, "credited");
      const refunded = await createHold({ status: "captured" });
      await settle(refunded, "credited");
      await event(refunded, "refund", "refunded", 500);
      const disputed = await createHold({ status: "captured" });
      await settle(disputed, "credited");
      await event(disputed, "refund", "refunded", 100);
      await event(disputed, "chargeback", "charged_back");
      const released = await createHold({ status: "cancelled" });
      return { reserved, capturedPending, completed, refunded, disputed, released };
    }

    it("deriva cada estado con su precedencia", async () => {
      const h = await seedAllStatuses();
      const items = (await list("role=sender")).json().items as Array<{ id: string; status: string }>;
      const byId = Object.fromEntries(items.map((i) => [i.id, i.status]));
      expect(byId).toEqual({
        [h.reserved.id]: "reserved",
        [h.capturedPending.id]: "reserved",
        [h.completed.id]: "completed",
        [h.refunded.id]: "refunded",
        [h.disputed.id]: "disputed",
        [h.released.id]: "released",
      });
    });

    it.each(["reserved", "completed", "refunded", "disputed", "released"])(
      "el filtro status=%s coincide con el estado de cada ítem",
      async (status) => {
        await seedAllStatuses();
        const items = (await list(`role=sender&status=${status}`)).json().items as Array<{ status: string }>;
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((i) => i.status === status)).toBe(true);
      }
    );

    it("acepta varios status (repetidos o separados por coma) y rechaza uno desconocido", async () => {
      await seedAllStatuses();
      const repeated = await list("role=sender&status=completed&status=refunded");
      expect(repeated.json().items.map((i: { status: string }) => i.status).sort()).toEqual(["completed", "refunded"]);
      const commas = await list("role=sender&status=completed,refunded");
      expect(commas.json().items).toHaveLength(2);
      expect((await list("role=sender&status=bogus")).statusCode).toBe(400);
    });

    it("el filtro se aplica antes de paginar: cada página trae limit ítems del estado", async () => {
      for (let i = 0; i < 3; i += 1) {
        await createHold({ status: "authorized", createdAt: new Date(Date.UTC(2026, 9, 1, 12, i)) });
      }
      for (let i = 0; i < 4; i += 1) {
        const h = await createHold({ status: "captured", createdAt: new Date(Date.UTC(2026, 9, 2, 12, i)) });
        await settle(h, "credited");
      }
      // Los completados son los más recientes: sin filtrar en la base, la primera página saldría vacía.
      const page1 = (await list("role=sender&status=reserved&limit=2")).json();
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = (await list(`role=sender&status=reserved&limit=2&cursor=${page1.nextCursor}`)).json();
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });
  });

  describe("reembolsos (AC5)", () => {
    it("refundedAmountArs es el último monto informado, no la suma", async () => {
      const h = await createHold({ status: "captured" });
      await settle(h, "credited");
      await event(h, "refund", "partially_refunded", 300, new Date("2026-10-11T10:00:00Z"));
      await event(h, "refund", "refunded", 1150, new Date("2026-10-12T10:00:00Z"));
      const item = (await list("role=sender")).json().items[0];
      expect(item.status).toBe("refunded");
      expect(item.refundedAmountArs).toBe(1150);
    });

    // MOVO-336 (AC6): los reembolsos que pide Movo viven en `payments.refunds`, no en los eventos de MP.
    function refundAttempt(
      h: SeededHold,
      settlementId: string,
      attempt: number,
      status: "processing" | "succeeded" | "failed" | "fallback_to_ledger",
      amountArs: number,
      completedAt = new Date("2026-10-13T10:00:00Z")
    ) {
      return app.db.refund.create({
        data: {
          settlementId,
          shipmentId: h.shipmentId,
          holdId: h.id,
          carrierId: CARRIER,
          mpPaymentId: h.mpPaymentId as string,
          attempt,
          amountArs,
          reason: "Disputa resuelta",
          requestKey: `dispute-${attempt}`,
          requestFingerprint: "fp",
          adminId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          mpIdempotencyKey: `movo-refund-${settlementId}-${attempt}`,
          status,
          completedAt,
          // Un UPDATE posterior de la fila no tiene que mover la fecha del movimiento.
          updatedAt: new Date("2026-10-20T10:00:00Z"),
        },
      });
    }

    it("un reembolso de Movo suma al estado, al monto y a los movimientos, para el emisor y el transportista (MOVO-336)", async () => {
      const h = await createHold({ status: "captured" });
      const s = await settle(h, "credited");
      await refundAttempt(h, s.id, 1, "succeeded", 300, new Date("2026-10-13T10:00:00Z"));
      await refundAttempt(h, s.id, 2, "succeeded", 200, new Date("2026-10-14T10:00:00Z"));

      const asSender = (await detail(h.id, "sender", SENDER)).json();
      expect(asSender.status).toBe("refunded");
      expect(asSender.refundedAmountArs).toBe(500);
      expect(asSender.movements).toEqual([
        { kind: "refund", amountArs: 300, date: "2026-10-13T10:00:00.000Z" },
        { kind: "refund", amountArs: 200, date: "2026-10-14T10:00:00.000Z" },
      ]);

      const asCarrier = (await detail(h.id, "carrier", CARRIER)).json();
      expect(asCarrier.status).toBe("refunded");
      expect(asCarrier.refundedAmountArs).toBe(500);
      expect(asCarrier.movements).toHaveLength(2);
      // El estado también se filtra en SQL: el espejo de `deriveTransactionStatus` tiene que ver el reembolso propio.
      expect((await list("role=sender&status=refunded")).json().items.map((i: { id: string }) => i.id)).toEqual([h.id]);
      expect((await list("role=sender&status=completed")).json().items).toEqual([]);
    });

    it("si MP informa un total mayor al propio (hubo otro reembolso por fuera), el monto es el total y no subestima (MOVO-336)", async () => {
      const h = await createHold({ status: "captured" });
      const s = await settle(h, "credited");
      await refundAttempt(h, s.id, 1, "succeeded", 300);
      // MP informa lo devuelto en total (incluye los 300 de Movo).
      await event(h, "refund", "refunded", 1150, new Date("2026-10-15T10:00:00Z"));

      const item = (await detail(h.id, "sender", SENDER)).json();

      expect(item.status).toBe("refunded");
      expect(item.refundedAmountArs).toBe(1150);
    });

    it("la fecha del movimiento propio es completed_at, no updated_at", async () => {
      const h = await createHold({ status: "captured" });
      const s = await settle(h, "credited");
      await refundAttempt(h, s.id, 1, "succeeded", 300, new Date("2026-10-13T10:00:00Z"));

      const asSender = (await detail(h.id, "sender", SENDER)).json();

      expect(asSender.movements).toEqual([{ kind: "refund", amountArs: 300, date: "2026-10-13T10:00:00.000Z" }]);
    });

    it("un intento en curso, fallido o caído al fallback no es un reembolso: el emisor todavía no recibió la plata (MOVO-336)", async () => {
      const h = await createHold({ status: "captured" });
      const s = await settle(h, "credited");
      await refundAttempt(h, s.id, 1, "processing", 100);
      await refundAttempt(h, s.id, 2, "failed", 100);
      await refundAttempt(h, s.id, 3, "fallback_to_ledger", 100);

      const asSender = (await detail(h.id, "sender", SENDER)).json();
      expect(asSender.status).toBe("completed");
      expect(asSender.refundedAmountArs).toBeNull();
      expect(asSender.movements).toEqual([]);
    });
  });

  describe("hold con recargo del emisor por su deuda (MOVO-311)", () => {
    it("el transportista no ve el recargo en el monto reintegrado ni en los movimientos; el emisor sí", async () => {
      const h = await createHold({ status: "captured" });
      // Precio 1150 + recargo 200 = 1350 pagados.
      await app.db.hold.update({ where: { id: h.id }, data: { amountArs: 1350, debtSurchargeArs: 200 } });
      await settle(h, "credited");
      await event(h, "refund", "refunded", 1350, new Date("2026-10-11T10:00:00Z"));

      const asCarrier = (await detail(h.id, "carrier", CARRIER)).json();
      expect(asCarrier.amountArs).toBe(1150);
      expect(asCarrier.refundedAmountArs).toBe(1150);
      expect(asCarrier.movements).toEqual([{ kind: "refund", amountArs: 1150, date: "2026-10-11T10:00:00.000Z" }]);

      const asSender = (await detail(h.id, "sender", SENDER)).json();
      expect(asSender.amountArs).toBe(1350);
      expect(asSender.refundedAmountArs).toBe(1350);
    });
  });

  describe("fechas en hora de Argentina (AC4)", () => {
    it("un pago de las 23:30 queda en su día y el límite to es inclusivo", async () => {
      // 23:30 del 10/10 en Argentina = 02:30 UTC del 11/10.
      const late = await createHold({ createdAt: new Date("2026-10-11T02:30:00Z") });
      // 00:30 del 11/10 en Argentina = 03:30 UTC del 11/10.
      const next = await createHold({ createdAt: new Date("2026-10-11T03:30:00Z") });

      const day10 = (await list("role=sender&from=2026-10-10&to=2026-10-10")).json().items;
      expect(day10.map((i: { id: string }) => i.id)).toEqual([late.id]);

      const day11 = (await list("role=sender&from=2026-10-11&to=2026-10-11")).json().items;
      expect(day11.map((i: { id: string }) => i.id)).toEqual([next.id]);

      const both = (await list("role=sender&from=2026-10-10&to=2026-10-11")).json().items;
      expect(both).toHaveLength(2);
    });

    it("rechaza fechas inválidas y from posterior a to", async () => {
      expect((await list("role=sender&from=2026-02-30")).statusCode).toBe(400);
      expect((await list("role=sender&from=10/10/2026")).statusCode).toBe(400);
      expect((await list("role=sender&from=2026-10-12&to=2026-10-10")).statusCode).toBe(400);
    });
  });

  describe("paginación por cursor (AC1, AC3)", () => {
    it("recorre todo sin duplicados ni saltos, incluso con la misma fecha", async () => {
      const sameInstant = new Date("2026-10-05T12:00:00.123Z");
      const ids: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const h = await createHold({ createdAt: i < 4 ? sameInstant : new Date(Date.UTC(2026, 9, 6, 12, i)) });
        ids.push(h.id);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: { items: Array<{ id: string }>; nextCursor: string | null } = (
          await list(`role=sender&limit=3${cursor ? `&cursor=${cursor}` : ""}`)
        ).json();
        seen.push(...res.items.map((i) => i.id));
        cursor = res.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(7);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it("el orden es del más reciente al más antiguo", async () => {
      const old = await createHold({ createdAt: new Date("2026-10-01T10:00:00Z") });
      const recent = await createHold({ createdAt: new Date("2026-10-02T10:00:00Z") });
      const items = (await list("role=sender")).json().items;
      expect(items.map((i: { id: string }) => i.id)).toEqual([recent.id, old.id]);
    });

    it("limit tiene tope 50 y un cursor inválido es 400", async () => {
      expect((await list("role=sender&limit=51")).statusCode).toBe(400);
      expect((await list("role=sender&cursor=basura")).statusCode).toBe(400);
    });

    it("un cursor con fecha que Date.parse acepta pero Postgres no es 400, no 500", async () => {
      const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
      const id = uuid();
      for (const createdAt of ["1", "2026-10-05", "2026-02-30T12:00:00.000000Z", "2026-10-05T12:00:00Z"]) {
        const res = await list(`role=sender&cursor=${encode(`${createdAt}|${id}`)}`);
        expect(res.statusCode, createdAt).toBe(400);
      }
    });

    it("status tiene tope de valores", async () => {
      const many = Array.from({ length: 21 }, () => "reserved").join("&status=");
      expect((await list(`role=sender&status=${many}`)).statusCode).toBe(400);
    });
  });

  describe("detalle (AC10-12)", () => {
    it("trae capturedAt y los movimientos en orden", async () => {
      const h = await createHold({ status: "captured" });
      await settle(h, "credited");
      await event(h, "refund", "partially_refunded", 200, new Date("2026-10-11T10:00:00Z"));
      await event(h, "mediation", "in_mediation", null, new Date("2026-10-12T10:00:00Z"));
      const res = await detail(h.id, "sender", SENDER);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("disputed");
      expect(body.capturedAt).toBe("2026-10-10T15:00:00.000Z");
      expect(body.movements).toEqual([
        { kind: "refund", amountArs: 200, date: "2026-10-11T10:00:00.000Z" },
        { kind: "mediation", amountArs: null, date: "2026-10-12T10:00:00.000Z" },
      ]);
    });

    it("los movimientos usan el mismo mp_payment_id que el estado", async () => {
      const h = await createHold({ status: "captured" });
      await settle(h, "credited");
      // Un evento de otro pago del mismo hold (re-adoptado): ni cuenta para el estado ni se lista.
      await app.db.paymentProviderEvent.create({
        data: {
          holdId: h.id,
          shipmentId: h.shipmentId,
          mpPaymentId: "otro-pago",
          kind: "chargeback",
          mpStatus: "charged_back",
          holdStatus: "captured",
        },
      });
      const body = (await detail(h.id, "sender", SENDER)).json();
      expect(body.status).toBe("completed");
      expect(body.movements).toEqual([]);
    });

    it("el desglose viaja solo para el transportista y solo con la liquidación acreditada", async () => {
      const credited = await createHold({ status: "captured" });
      await settle(credited, "credited");
      const processing = await createHold({ status: "captured" });
      await settle(processing, "processing");

      const ok = (await detail(credited.id, "carrier", CARRIER)).json();
      expect(ok.breakdown).toEqual({
        grossArs: 1150,
        mpFeeArs: 47.15,
        commissionArs: 150,
        debtOffsetArs: 0,
        netArs: 952.85,
      });
      expect("card" in ok).toBe(false);

      expect((await detail(processing.id, "carrier", CARRIER)).json().breakdown).toBeNull();

      const asSender = await detail(credited.id, "sender", SENDER);
      expect(asSender.statusCode).toBe(200);
      expect("breakdown" in asSender.json()).toBe(false);
      expect(asSender.json().card).toEqual({ brand: "visa", last4: "3764", alias: null, issuerName: null, paymentType: null });
    });

    it("una transacción ajena, de otro rol o inexistente responde el mismo 404", async () => {
      const h = await createHold();
      const foreign = await detail(h.id, "sender", OTHER);
      const wrongRole = await detail(h.id, "carrier", SENDER);
      const missing = await detail(uuid(), "sender", SENDER);
      for (const res of [foreign, wrongRole, missing]) expect(res.statusCode).toBe(404);
      expect(foreign.json().error).toEqual(missing.json().error);
    });

    it("un hold no visible (rejected) es 404", async () => {
      const h = await createHold({ status: "rejected", mpPaymentId: null });
      expect((await detail(h.id, "sender", SENDER)).statusCode).toBe(404);
    });
  });

  describe("deuda de la cuenta corriente en el historial (MOVO-311, MOVO-312)", () => {
    async function createCard(userId = SENDER) {
      return app.db.savedCard.create({
        data: { userId, mpCardId: `mp-card-${uuid()}`, brand: "master", last4: "1881", expMonth: 12, expYear: 2030 },
      });
    }

    function createAttempt(
      overrides: { userId?: string; status?: "creating" | "pending" | "approved" | "rejected" | "failed"; amountArs?: number; savedCardId?: string | null; createdAt?: Date } = {}
    ) {
      const id = uuid();
      return app.db.balancePaymentAttempt.create({
        data: {
          id,
          userId: overrides.userId ?? SENDER,
          amountArs: overrides.amountArs ?? 1500,
          status: overrides.status ?? "approved",
          savedCardId: overrides.savedCardId === undefined ? null : overrides.savedCardId,
          requestFingerprint: `fp-${id}`,
          mpPaymentId: `mp-balance-${id}`,
          ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
        },
      });
    }

    it("el emisor ve sus pagos de saldo aprobados junto a los pagos de envíos, sin envío y con la tarjeta", async () => {
      const card = await createCard();
      const hold = await createHold({ createdAt: new Date("2026-10-08T12:00:00Z") });
      const attempt = await createAttempt({ savedCardId: card.id, createdAt: new Date("2026-10-09T12:00:00Z") });

      const items = (await list("role=sender")).json().items;
      expect(items.map((i: { id: string }) => i.id)).toEqual([attempt.id, hold.id]);
      expect(items[0]).toEqual({
        id: attempt.id,
        kind: "balance_payment",
        shipmentId: null,
        destinationLabel: null,
        date: "2026-10-09T12:00:00.000Z",
        amountArs: 1500,
        status: "completed",
        refundedAmountArs: null,
        debtAmountArs: null,
        card: { brand: "master", last4: "1881", alias: null, issuerName: null, paymentType: null },
      });
      expect(items[1].kind).toBe("shipment");
    });

    it("solo lista los intentos aprobados, y solo del propio usuario", async () => {
      // Un índice parcial deja un solo intento abierto (`creating`/`pending`) por usuario: el pendiente va en otro.
      for (const status of ["creating", "rejected", "failed"] as const) await createAttempt({ status });
      await createAttempt({ userId: CARRIER, status: "pending" });
      await createAttempt({ userId: OTHER });
      const mine = await createAttempt();

      const items = (await list("role=sender")).json().items;
      expect(items.map((i: { id: string }) => i.id)).toEqual([mine.id]);
    });

    it("sin tarjeta guardada (intento sin savedCardId) devuelve card null", async () => {
      await createAttempt({ savedCardId: null });
      expect((await list("role=sender")).json().items[0].card).toBeNull();
    });

    it("el transportista no ve pagos de saldo", async () => {
      await createAttempt({ userId: CARRIER });
      expect((await list("role=carrier", CARRIER)).json().items).toEqual([]);
    });

    it("los filtros de estado y de fechas aplican a los pagos de saldo", async () => {
      const early = await createAttempt({ createdAt: new Date("2026-10-05T15:00:00Z") });
      const late = await createAttempt({ createdAt: new Date("2026-10-20T15:00:00Z") });
      await createHold({ status: "authorized", createdAt: new Date("2026-10-06T15:00:00Z") });

      const completed = (await list("role=sender&status=completed")).json().items;
      expect(completed.map((i: { id: string }) => i.id).sort()).toEqual([early.id, late.id].sort());
      expect((await list("role=sender&status=reserved")).json().items.map((i: { kind: string }) => i.kind)).toEqual(["shipment"]);
      const range = (await list("role=sender&from=2026-10-15&to=2026-10-25")).json().items;
      expect(range.map((i: { id: string }) => i.id)).toEqual([late.id]);
    });

    it("pagina por cursor mezclando holds y pagos de saldo sin repetir ni perder filas", async () => {
      const ids: string[] = [];
      for (let day = 1; day <= 6; day += 1) {
        const at = new Date(`2026-10-0${day}T12:00:00Z`);
        ids.push(day % 2 === 0 ? (await createAttempt({ createdAt: at })).id : (await createHold({ createdAt: at })).id);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = (await list(`role=sender&limit=2${cursor ? `&cursor=${cursor}` : ""}`)).json();
        seen.push(...res.items.map((i: { id: string }) => i.id));
        cursor = res.nextCursor;
      } while (cursor);
      expect(seen).toEqual([...ids].reverse());
    });

    it("el detalle de un pago de saldo no trae movimientos ni desglose, y es 404 para otro rol o usuario", async () => {
      const attempt = await createAttempt();
      const res = await detail(attempt.id, "sender", SENDER);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ kind: "balance_payment", shipmentId: null, movements: [], capturedAt: null });
      expect("breakdown" in res.json()).toBe(false);
      expect((await detail(attempt.id, "carrier", SENDER)).statusCode).toBe(404);
      expect((await detail(attempt.id, "sender", OTHER)).statusCode).toBe(404);
    });

    it("el emisor ve el recargo por su deuda dentro de lo que pagó, salvo que el hold se haya liberado", async () => {
      const withDebt = await app.db.hold.create({
        data: {
          shipmentId: uuid(), attempt: 1, carrierId: CARRIER, collectorId: "mp-collector", mpPaymentId: `mp-${uuid()}`,
          amountArs: 1400, baseAmountArs: 1150, debtSurchargeArs: 250, applicationFeeArs: 150, commissionArs: 150,
          status: "authorized", payerId: SENDER,
        },
      });
      const released = await app.db.hold.create({
        data: {
          shipmentId: uuid(), attempt: 1, carrierId: CARRIER, collectorId: "mp-collector", mpPaymentId: `mp-${uuid()}`,
          amountArs: 1400, baseAmountArs: 1150, debtSurchargeArs: 250, applicationFeeArs: 150, commissionArs: 150,
          status: "cancelled", payerId: SENDER,
        },
      });
      const clean = await createHold();

      const byId = Object.fromEntries(
        ((await list("role=sender")).json().items as Array<{ id: string; amountArs: number; debtAmountArs: number | null }>).map((i) => [i.id, i])
      );
      expect(byId[withDebt.id]).toMatchObject({ amountArs: 1400, debtAmountArs: 250 });
      expect(byId[released.id].debtAmountArs).toBeNull();
      expect(byId[clean.id].debtAmountArs).toBeNull();
    });

    it("el transportista ve lo descontado de su cobro solo con la liquidación acreditada", async () => {
      const credited = await createHold({ status: "captured" });
      await app.db.settlement.create({
        data: {
          shipmentId: credited.shipmentId, holdId: credited.id, carrierId: CARRIER, mpPaymentId: credited.mpPaymentId as string,
          grossAmountArs: 1150, commissionArs: 150, mpFeeArs: 47.15, carrierGrossAmountArs: 1150, carrierMpFeeArs: 47.15,
          netAmountArs: 952.85, debtOffsetArs: 200, status: "credited", capturedAt: new Date("2026-10-10T15:00:00Z"),
        },
      });
      const processing = await createHold({ status: "captured" });
      await app.db.settlement.create({
        data: {
          shipmentId: processing.shipmentId, holdId: processing.id, carrierId: CARRIER, mpPaymentId: processing.mpPaymentId as string,
          grossAmountArs: 1150, commissionArs: 150, debtOffsetArs: 200, status: "processing",
        },
      });

      const byId = Object.fromEntries(
        ((await list("role=carrier", CARRIER)).json().items as Array<{ id: string; debtAmountArs: number | null }>).map((i) => [i.id, i.debtAmountArs])
      );
      expect(byId[credited.id]).toBe(200);
      expect(byId[processing.id]).toBeNull();
    });
  });

  describe("datos de la tarjeta y de la liberación en el detalle", () => {
    it("un hold con tarjeta guardada trae alias, banco y tipo, y completa marca y últimos 4 si MP no los informó", async () => {
      const card = await app.db.savedCard.create({
        data: {
          userId: SENDER, mpCardId: `mp-card-${uuid()}`, brand: "visa", last4: "3704", expMonth: 12, expYear: 2030,
          alias: "Personal", issuerName: "Banco Galicia", paymentType: "credit_card",
        },
      });
      const hold = await createHold({ cardBrand: null, cardLast4: null });
      await app.db.hold.update({ where: { id: hold.id }, data: { savedCardId: card.id } });

      const body = (await detail(hold.id, "sender", SENDER)).json();
      expect(body.card).toEqual({
        brand: "visa", last4: "3704", alias: "Personal", issuerName: "Banco Galicia", paymentType: "credit_card",
      });
      expect((await list("role=sender")).json().items[0].card.alias).toBe("Personal");
    });

    it("un hold sin tarjeta guardada trae los datos de la tarjeta en null", async () => {
      const hold = await createHold();
      const { card } = (await detail(hold.id, "sender", SENDER)).json();
      expect(card).toEqual({ brand: "visa", last4: "3764", alias: null, issuerName: null, paymentType: null });
    });

    it("un hold liberado informa cuándo (lo fija la base al cancelarse) y por qué", async () => {
      const cancelled = await createHold({ status: "authorized" });
      const before = Date.now();
      await app.db.hold.update({ where: { id: cancelled.id }, data: { status: "cancelled", statusDetail: "by_collector" } });
      const expired = await createHold({ status: "authorized" });
      await app.db.hold.update({ where: { id: expired.id }, data: { status: "cancelled", statusDetail: "expired" } });

      const a = (await detail(cancelled.id, "sender", SENDER)).json();
      expect(a.status).toBe("released");
      expect(a.releaseReason).toBeNull();
      expect(Date.parse(a.releasedAt)).toBeGreaterThanOrEqual(before - 1000);
      expect((await detail(expired.id, "sender", SENDER)).json().releaseReason).toBe("expired");
    });

    it("la fecha de liberación no cambia con updates posteriores, y un hold no liberado no la trae", async () => {
      const hold = await createHold({ status: "authorized" });
      await app.db.hold.update({ where: { id: hold.id }, data: { status: "cancelled" } });
      const first = (await detail(hold.id, "sender", SENDER)).json().releasedAt;
      await app.db.hold.update({ where: { id: hold.id }, data: { cardLast4: "9999" } });
      expect((await detail(hold.id, "sender", SENDER)).json().releasedAt).toBe(first);

      const active = await createHold({ status: "authorized" });
      const body = (await detail(active.id, "sender", SENDER)).json();
      expect(body.releasedAt).toBeNull();
      expect(body.releaseReason).toBeNull();
    });

    it("fecha también los holds insertados ya cancelados", async () => {
      const hold = await createHold({ status: "cancelled" });
      const body = (await detail(hold.id, "sender", SENDER)).json();
      expect(body.status).toBe("released");
      expect(body.releasedAt).not.toBeNull();
    });
  });
});
