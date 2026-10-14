import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { MAX_SAVED_CARDS_PER_USER } from "@movo/shared";
import { buildApp } from "../src/app";
import {
  MercadoPagoCustomersClient,
  MercadoPagoCustomersError,
  MpSavedCard,
} from "../src/adapters/mercadopago-customers-client";
import type { UsersClient } from "../src/adapters/users-client";

// Integración contra Postgres y Redis reales (convención del repo); solo se reemplazan el
// cliente de Customers & Cards de MP y el de svc-users. Guardar/listar/borrar contra el
// sandbox real vive en `cards.sandbox.test.ts`.

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let nextCard = 0;
function mpCard(overrides: Partial<MpSavedCard> = {}): MpSavedCard {
  nextCard += 1;
  return {
    id: `mp-card-${nextCard}`,
    brand: "visa",
    last4: String(1000 + nextCard),
    expMonth: 11,
    expYear: 2030,
    ...overrides,
  };
}

describe("/payments/cards (MOVO-100)", () => {
  let app: FastifyInstance;
  const mp = {
    createCustomer: vi.fn(),
    findCustomerByEmail: vi.fn(),
    customerExists: vi.fn(),
    saveCard: vi.fn(),
    deleteCard: vi.fn(),
    deleteCustomer: vi.fn(),
  };
  const users: UsersClient = { findAccountEmail: vi.fn(async () => "emisor@example.com") };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_PUBLIC_KEY = "TEST-public-key-de-movo";
    app = buildApp({
      mercadoPagoCustomersClient: mp as unknown as MercadoPagoCustomersClient,
      usersClient: users,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_PUBLIC_KEY;
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.saved_cards, payments.payer_customers, payments.holds");
    nextCard = 0;
    for (const fn of Object.values(mp)) fn.mockReset();
    mp.createCustomer.mockResolvedValue({ id: "mp-customer-1" });
    mp.saveCard.mockImplementation(async () => mpCard());
    mp.deleteCard.mockResolvedValue(undefined);
    mp.deleteCustomer.mockResolvedValue(undefined);
    mp.customerExists.mockResolvedValue(true);
    vi.mocked(users.findAccountEmail).mockClear();
  });

  const as = (userId: string) => ({ "x-user-id": userId });
  const add = (payload: Record<string, unknown> = {}, userId = USER) =>
    app.inject({ method: "POST", url: "/payments/cards", headers: as(userId), payload: { cardToken: "tok-1", ...payload } });
  const list = (userId = USER) => app.inject({ method: "GET", url: "/payments/cards", headers: as(userId) });

  it("exige x-user-id", async () => {
    const res = await app.inject({ method: "GET", url: "/payments/cards" });
    expect(res.statusCode).toBe(401);
  });

  describe("migración (AC1)", () => {
    it("los índices únicos son parciales sobre las filas vivas", async () => {
      const rows = await app.db.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'payments' AND tablename = 'saved_cards'"
      );
      const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(byName["saved_cards_user_id_mp_card_id_live_key"]).toMatch(/UNIQUE.*\(user_id, mp_card_id\).*WHERE \(?deleted_at IS NULL\)?/s);
      expect(byName["saved_cards_user_id_default_live_key"]).toMatch(/UNIQUE.*\(user_id\).*WHERE.*is_default.*deleted_at IS NULL/s);
    });

    it("un customer de MP pertenece a una sola cuenta", async () => {
      await app.db.payerCustomer.create({ data: { userId: USER, mpCustomerId: "mp-customer-1" } });
      await expect(app.db.payerCustomer.create({ data: { userId: OTHER_USER, mpCustomerId: "mp-customer-1" } })).rejects.toMatchObject({
        code: "P2002",
      });
    });
  });

  describe("checkout-data", () => {
    it("devuelve la public_key de Movo", async () => {
      const res = await app.inject({ method: "GET", url: "/payments/cards/checkout-data", headers: as(USER) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ publicKey: "TEST-public-key-de-movo" });
    });
  });

  describe("alta", () => {
    it("crea el customer, guarda la tarjeta y la deja predeterminada", async () => {
      const res = await add({ alias: "  Visa del trabajo " });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        mpCardId: "mp-card-1",
        alias: "Visa del trabajo",
        brand: "visa",
        last4: "1001",
        expMonth: 11,
        expYear: 2030,
        isDefault: true,
      });
      expect(mp.createCustomer).toHaveBeenCalledWith("emisor@example.com");
      expect(mp.saveCard).toHaveBeenCalledWith("mp-customer-1", "tok-1");
      const customer = await app.db.payerCustomer.findUnique({ where: { userId: USER } });
      expect(customer?.mpCustomerId).toBe("mp-customer-1");
    });

    it("sin alias queda en null y la segunda tarjeta reusa el customer y no es predeterminada", async () => {
      expect((await add()).json().alias).toBeNull();
      const second = await add();
      expect(second.statusCode).toBe(201);
      expect(second.json().isDefault).toBe(false);
      expect(mp.createCustomer).toHaveBeenCalledTimes(1);
      expect(users.findAccountEmail).toHaveBeenCalledTimes(1);
    });

    it("una tarjeta repetida responde 200 con la existente, sin fila nueva, y borra la copia de MP", async () => {
      const first = await add({ alias: "Original" });
      mp.saveCard.mockResolvedValueOnce(mpCard({ brand: "visa", last4: "1001", expMonth: 11, expYear: 2030 }));
      const dup = await add({ alias: "Otro nombre" });
      expect(dup.statusCode).toBe(200);
      expect(dup.json().id).toBe(first.json().id);
      expect(dup.json().alias).toBe("Original");
      expect(await app.db.savedCard.count({ where: { userId: USER } })).toBe(1);
      expect(mp.deleteCard).toHaveBeenCalledWith("mp-customer-1", "mp-card-2");
    });

    it("si MP devuelve el mismo id de tarjeta, no la borra", async () => {
      await add();
      mp.saveCard.mockResolvedValueOnce({ id: "mp-card-1", brand: "visa", last4: "1001", expMonth: 11, expYear: 2030 });
      const dup = await add();
      expect(dup.statusCode).toBe(200);
      expect(mp.deleteCard).not.toHaveBeenCalled();
    });

    it("rechaza al pasar el tope de tarjetas vivas sin llamar a MP", async () => {
      for (let i = 0; i < MAX_SAVED_CARDS_PER_USER; i++) expect((await add()).statusCode).toBe(201);
      mp.saveCard.mockClear();
      const res = await add();
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CARD_LIMIT_REACHED");
      expect(mp.saveCard).not.toHaveBeenCalled();
    });

    it("si MP rechaza el alta devuelve el motivo en el formato de error", async () => {
      mp.saveCard.mockRejectedValueOnce(new MercadoPagoCustomersError("save_card", 400, "205", "MP respondió 400"));
      const res = await add();
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: "CARD_SAVE_REJECTED", details: { providerCode: "205" } });
      expect(await app.db.savedCard.count()).toBe(0);
    });

    it("si MP no responde devuelve 502 y no persiste nada", async () => {
      mp.saveCard.mockRejectedValueOnce(new MercadoPagoCustomersError("save_card", null, null, "MP no respondió"));
      const res = await add();
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe("PAYMENT_PROVIDER_ERROR");
    });

    it("si el email ya tiene customer en MP (101) lo busca y lo reusa", async () => {
      mp.createCustomer.mockRejectedValueOnce(new MercadoPagoCustomersError("create_customer", 400, "101", "MP respondió 400"));
      mp.findCustomerByEmail.mockResolvedValueOnce({ id: "mp-customer-existente" });
      const res = await add();
      expect(res.statusCode).toBe(201);
      expect(mp.saveCard).toHaveBeenCalledWith("mp-customer-existente", "tok-1");
      expect((await app.db.payerCustomer.findUnique({ where: { userId: USER } }))?.mpCustomerId).toBe("mp-customer-existente");
    });

    it("si el customer del email (101) ya es de otra cuenta responde 409 y no lo adopta", async () => {
      await app.db.payerCustomer.create({ data: { userId: OTHER_USER, mpCustomerId: "mp-customer-ajeno" } });
      mp.createCustomer.mockRejectedValueOnce(new MercadoPagoCustomersError("create_customer", 400, "101", "MP respondió 400"));
      mp.findCustomerByEmail.mockResolvedValueOnce({ id: "mp-customer-ajeno" });
      const res = await add();
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CARD_CUSTOMER_CONFLICT");
      expect(mp.saveCard).not.toHaveBeenCalled();
      expect(await app.db.payerCustomer.findUnique({ where: { userId: USER } })).toBeNull();
    });

    it("si el customer guardado ya no existe en MP, lo reemplaza y da de baja sus tarjetas", async () => {
      const old = await add();
      mp.saveCard.mockRejectedValueOnce(new MercadoPagoCustomersError("save_card", 404, null, "MP respondió 404"));
      mp.customerExists.mockResolvedValueOnce(false);
      mp.createCustomer.mockResolvedValueOnce({ id: "mp-customer-2" });
      const res = await add();
      expect(res.statusCode).toBe(201);
      expect(res.json().isDefault).toBe(true);
      expect(mp.customerExists).toHaveBeenCalledWith("mp-customer-1");
      expect(mp.saveCard).toHaveBeenLastCalledWith("mp-customer-2", "tok-1");
      expect((await app.db.payerCustomer.findUnique({ where: { userId: USER } }))?.mpCustomerId).toBe("mp-customer-2");
      expect((await app.db.savedCard.findUnique({ where: { id: old.json().id } }))?.deletedAt).not.toBeNull();
    });

    it("un 404 al guardar con el customer todavía vivo es un rechazo y no toca nada", async () => {
      const old = await add();
      mp.saveCard.mockRejectedValueOnce(new MercadoPagoCustomersError("save_card", 404, null, "MP respondió 404"));
      const res = await add();
      expect(res.statusCode).toBe(422);
      expect(mp.createCustomer).toHaveBeenCalledTimes(1);
      expect((await app.db.savedCard.findUnique({ where: { id: old.json().id } }))?.deletedAt).toBeNull();
    });

    it("si falla la base tras guardar en MP, no borra una tarjeta que el usuario ya tenía", async () => {
      await add();
      mp.saveCard.mockResolvedValueOnce({ id: "mp-card-1", brand: "visa", last4: "1001", expMonth: 11, expYear: 2030 });
      const spy = vi.spyOn(app.db, "$transaction").mockRejectedValueOnce(new Error("db caída"));
      const res = await add();
      spy.mockRestore();
      expect(res.statusCode).toBe(500);
      expect(mp.deleteCard).not.toHaveBeenCalled();
    });

    it("si falla la base tras guardar en MP, borra la copia nueva", async () => {
      const spy = vi.spyOn(app.db, "$transaction").mockRejectedValueOnce(new Error("db caída"));
      const res = await add();
      spy.mockRestore();
      expect(res.statusCode).toBe(500);
      expect(mp.deleteCard).toHaveBeenCalledWith("mp-customer-1", "mp-card-1");
    });

    it("falla cerrado si svc-users no puede dar el email", async () => {
      vi.mocked(users.findAccountEmail).mockResolvedValueOnce(null);
      const res = await add();
      expect(res.statusCode).toBe(502);
      expect(mp.createCustomer).not.toHaveBeenCalled();
    });

    it("valida el body", async () => {
      const res = await app.inject({ method: "POST", url: "/payments/cards", headers: as(USER), payload: {} });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("alias", () => {
    it.each([
      ["supera 40 caracteres", "x".repeat(41)],
      ["trae una secuencia de 12+ dígitos", "mi tarjeta 411111111111"],
      ["trae el número con espacios", "4111 1111 1111 1111"],
      ["trae caracteres de control", "Visa\nroja"],
    ])("rechaza en el alta un alias que %s", async (_name, alias) => {
      const res = await add({ alias });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_FAILED");
      expect(mp.saveCard).not.toHaveBeenCalled();
    });

    it("acepta 40 caracteres justos y hasta 11 dígitos", async () => {
      expect((await add({ alias: "x".repeat(40) })).statusCode).toBe(201);
      expect((await add({ alias: "tarjeta 12345678901" })).statusCode).toBe(201);
    });

    it("se edita con PATCH, y null o vacío lo borra", async () => {
      const { id } = (await add({ alias: "Viejo" })).json();
      const edited = await app.inject({ method: "PATCH", url: `/payments/cards/${id}`, headers: as(USER), payload: { alias: " Nuevo " } });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().alias).toBe("Nuevo");
      for (const alias of [null, "   "]) {
        const cleared = await app.inject({ method: "PATCH", url: `/payments/cards/${id}`, headers: as(USER), payload: { alias } });
        expect(cleared.json().alias).toBeNull();
      }
    });

    it("rechaza editar con un alias inválido", async () => {
      const { id } = (await add()).json();
      const res = await app.inject({ method: "PATCH", url: `/payments/cards/${id}`, headers: as(USER), payload: { alias: "1".repeat(16) } });
      expect(res.statusCode).toBe(400);
    });

    it("no es único: dos tarjetas pueden llamarse igual", async () => {
      expect((await add({ alias: "Igual" })).statusCode).toBe(201);
      expect((await add({ alias: "Igual" })).statusCode).toBe(201);
    });

    it("editar la tarjeta de otro usuario responde 404", async () => {
      const { id } = (await add({ alias: "Mía" })).json();
      const res = await app.inject({ method: "PATCH", url: `/payments/cards/${id}`, headers: as(OTHER_USER), payload: { alias: "Robada" } });
      expect(res.statusCode).toBe(404);
      expect((await list()).json()[0].alias).toBe("Mía");
    });
  });

  describe("listado", () => {
    it("devuelve solo las vivas del usuario, la predeterminada primero, sin datos sensibles", async () => {
      await add();
      const second = (await add()).json();
      await add({}, OTHER_USER);
      await app.inject({ method: "PATCH", url: `/payments/cards/${second.id}/default`, headers: as(USER) });

      const res = await list();
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe(second.id);
      expect(Object.keys(body[0]).sort()).toEqual(
        ["alias", "brand", "createdAt", "expMonth", "expYear", "id", "isDefault", "last4", "mpCardId"]
      );
      expect(res.body).not.toContain("tok-1");
    });

    it("ninguna respuesta del alta ni del listado contiene el cardToken", async () => {
      const created = await add({ cardToken: "tok-super-secreto" });
      expect(created.body).not.toContain("tok-super-secreto");
      expect((await list()).body).not.toContain("tok-super-secreto");
    });
  });

  describe("predeterminada", () => {
    it("marca una y desmarca la anterior: una sola vigente", async () => {
      const first = (await add()).json();
      const second = (await add()).json();
      const res = await app.inject({ method: "PATCH", url: `/payments/cards/${second.id}/default`, headers: as(USER) });
      expect(res.statusCode).toBe(200);
      expect(res.json().isDefault).toBe(true);
      const rows = await app.db.savedCard.findMany({ where: { userId: USER }, orderBy: { createdAt: "asc" } });
      expect(rows.map((r) => [r.id, r.isDefault])).toEqual([[first.id, false], [second.id, true]]);
    });

    it("es idempotente sobre la que ya lo es", async () => {
      const first = (await add()).json();
      const res = await app.inject({ method: "PATCH", url: `/payments/cards/${first.id}/default`, headers: as(USER) });
      expect(res.statusCode).toBe(200);
      expect(res.json().isDefault).toBe(true);
    });

    it("la base impide dos predeterminadas vivas", async () => {
      const a = (await add()).json();
      const b = (await add()).json();
      await expect(app.db.savedCard.update({ where: { id: b.id }, data: { isDefault: true } })).rejects.toThrow();
      expect((await app.db.savedCard.findUnique({ where: { id: a.id } }))?.isDefault).toBe(true);
    });

    it("una tarjeta ajena o inexistente responde 404", async () => {
      const { id } = (await add()).json();
      const other = await app.inject({ method: "PATCH", url: `/payments/cards/${id}/default`, headers: as(OTHER_USER) });
      expect(other.statusCode).toBe(404);
      const missing = await app.inject({ method: "PATCH", url: "/payments/cards/99999999-9999-4999-8999-999999999999/default", headers: as(USER) });
      expect(missing.statusCode).toBe(404);
    });
  });

  describe("baja", () => {
    it("borra en MP, marca deleted_at y deja de listarla", async () => {
      const second = (await add()).json();
      const res = await app.inject({ method: "DELETE", url: `/payments/cards/${second.id}`, headers: as(USER) });
      expect(res.statusCode).toBe(204);
      expect(mp.deleteCard).toHaveBeenCalledWith("mp-customer-1", "mp-card-1");
      expect((await list()).json()).toEqual([]);
      const row = await app.db.savedCard.findUnique({ where: { id: second.id } });
      expect(row?.deletedAt).not.toBeNull();
    });

    it("al borrar la predeterminada promueve a la más reciente viva", async () => {
      const first = (await add()).json();
      await add();
      const third = (await add()).json();
      await app.inject({ method: "DELETE", url: `/payments/cards/${first.id}`, headers: as(USER) });
      const cards = (await list()).json();
      expect(cards).toHaveLength(2);
      expect(cards[0].id).toBe(third.id);
      expect(cards[0].isDefault).toBe(true);
    });

    it("se puede volver a guardar una tarjeta dada de baja", async () => {
      const first = (await add()).json();
      await app.inject({ method: "DELETE", url: `/payments/cards/${first.id}`, headers: as(USER) });
      mp.saveCard.mockResolvedValueOnce({ id: "mp-card-1", brand: "visa", last4: "1001", expMonth: 11, expYear: 2030 });
      const again = await add();
      expect(again.statusCode).toBe(201);
      expect(again.json().isDefault).toBe(true);
    });

    it.each(["creating", "in_process", "authorized", "captured"])("responde 409 CARD_IN_USE con un hold %s", async (status) => {
      const card = (await add()).json();
      await app.db.hold.create({
        data: {
          shipmentId: SHIPMENT, attempt: 1, carrierId: CARRIER, collectorId: "1", amountArs: 1150, applicationFeeArs: 150,
          status: status as "creating", savedCardId: card.id,
        },
      });
      const res = await app.inject({ method: "DELETE", url: `/payments/cards/${card.id}`, headers: as(USER) });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CARD_IN_USE");
      expect(mp.deleteCard).not.toHaveBeenCalled();
      expect((await list()).json()).toHaveLength(1);
    });

    it("un hold cerrado (cancelled) no bloquea la baja", async () => {
      const card = (await add()).json();
      await app.db.hold.create({
        data: {
          shipmentId: SHIPMENT, attempt: 1, carrierId: CARRIER, collectorId: "1", amountArs: 1150, applicationFeeArs: 150,
          status: "cancelled", savedCardId: card.id,
        },
      });
      const res = await app.inject({ method: "DELETE", url: `/payments/cards/${card.id}`, headers: as(USER) });
      expect(res.statusCode).toBe(204);
    });

    it("si MP ya no tenía la tarjeta (el cliente tolera el 404) se da por borrada", async () => {
      const card = (await add()).json();
      mp.deleteCard.mockResolvedValueOnce(undefined);
      expect((await app.inject({ method: "DELETE", url: `/payments/cards/${card.id}`, headers: as(USER) })).statusCode).toBe(204);
    });

    it("si MP falla la baja, la tarjeta sigue viva y responde 502", async () => {
      const card = (await add()).json();
      mp.deleteCard.mockRejectedValueOnce(new MercadoPagoCustomersError("delete_card", 500, null, "MP respondió 500"));
      const res = await app.inject({ method: "DELETE", url: `/payments/cards/${card.id}`, headers: as(USER) });
      expect(res.statusCode).toBe(502);
      expect((await list()).json()).toHaveLength(1);
    });

    it("una tarjeta ajena responde 404 y no toca MP", async () => {
      const card = (await add()).json();
      const res = await app.inject({ method: "DELETE", url: `/payments/cards/${card.id}`, headers: as(OTHER_USER) });
      expect(res.statusCode).toBe(404);
      expect(mp.deleteCard).not.toHaveBeenCalled();
    });
  });

  describe("baja de cuenta (interno)", () => {
    it("borra el customer en MP y todas las filas locales", async () => {
      await add();
      await add();
      mp.createCustomer.mockResolvedValueOnce({ id: "mp-customer-otro" });
      await add({}, OTHER_USER);
      const res = await app.inject({ method: "DELETE", url: `/internal/payments/users/${USER}/cards` });
      expect(res.statusCode).toBe(204);
      expect(mp.deleteCustomer).toHaveBeenCalledWith("mp-customer-1");
      expect(await app.db.savedCard.count({ where: { userId: USER } })).toBe(0);
      expect(await app.db.payerCustomer.count({ where: { userId: USER } })).toBe(0);
      expect(await app.db.savedCard.count({ where: { userId: OTHER_USER } })).toBe(1);
    });

    it("es best-effort: si MP falla igual borra lo local y responde 204", async () => {
      await add();
      mp.deleteCustomer.mockRejectedValueOnce(new MercadoPagoCustomersError("delete_customer", 500, null, "MP respondió 500"));
      const res = await app.inject({ method: "DELETE", url: `/internal/payments/users/${USER}/cards` });
      expect(res.statusCode).toBe(204);
      expect(await app.db.savedCard.count({ where: { userId: USER } })).toBe(0);
    });

    it("sin tarjetas ni customer responde 204 sin llamar a MP", async () => {
      const res = await app.inject({ method: "DELETE", url: `/internal/payments/users/${USER}/cards` });
      expect(res.statusCode).toBe(204);
      expect(mp.deleteCustomer).not.toHaveBeenCalled();
    });

    it("no es alcanzable sin x-user-id desde /payments (no es una ruta pública)", async () => {
      const res = await app.inject({ method: "DELETE", url: `/payments/users/${USER}/cards` });
      expect([401, 404]).toContain(res.statusCode);
    });
  });
});

describe("/payments/cards sin configurar (MOVO-100)", () => {
  it("checkout-data responde 503 si falta MP_PUBLIC_KEY", async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    delete process.env.MP_PUBLIC_KEY;
    const app = buildApp({
      mercadoPagoCustomersClient: {} as unknown as MercadoPagoCustomersClient,
      usersClient: { findAccountEmail: async () => null },
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/payments/cards/checkout-data", headers: { "x-user-id": USER } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("CARDS_NOT_CONFIGURED");
    await app.close();
  });
});
