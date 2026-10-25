import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@movo/shared";
import { createShipmentsClient } from "../src/adapters/shipments-client";
import { createUsersClient } from "../src/adapters/users-client";
import { createPaymentsClient } from "../src/adapters/payments-client";

const ctx = { requestId: "req-294" };
const originalFetch = globalThis.fetch;

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new SyntaxError("sin cuerpo");
      return body;
    },
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function catchApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("se esperaba un ApiError");
}

const USER = "11111111-1111-4111-8111-111111111111";

describe("clientes internos de la ficha del panel (MOVO-294)", () => {
  const users = createUsersClient({ USERS_SERVICE_URL: "http://users" });
  const shipments = createShipmentsClient({ SHIPMENTS_SERVICE_URL: "http://shipments" });
  const payments = createPaymentsClient({ PAYMENTS_SERVICE_URL: "http://payments" });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("svc-users", () => {
    const profile = {
      id: USER,
      fullName: "Ana Ariza",
      email: "ana@movo.test",
      phone: "+5493511234567",
      accountStatus: "active",
      deletedAt: null,
      roles: [],
    };

    it("busca con q, page y pageSize en el querystring", async () => {
      const fetchMock = mockFetch(200, { items: [], page: 2, pageSize: 10, total: 0 });
      await users.searchUsers({ q: "ana ariza", page: 2, pageSize: 10 }, ctx);
      expect(fetchMock.mock.calls[0][0]).toBe("http://users/internal/admin/users?q=ana+ariza&page=2&pageSize=10");
    });

    it("cada sección de la ficha arma su URL y un 404 USER_NOT_FOUND se relanza como ApiError", async () => {
      const fetchMock = mockFetch(200, profile);
      await expect(users.getUserProfile(USER, ctx)).resolves.toEqual(profile);
      expect(fetchMock.mock.calls[0][0]).toBe(`http://users/internal/admin/users/${USER}`);

      mockFetch(404, { error: { code: "USER_NOT_FOUND", message: "x" } });
      const error = await catchApiError(users.getUserModeration(USER, ctx));
      expect([error.statusCode, error.code]).toEqual([404, "USER_NOT_FOUND"]);
    });

    it("valida la forma de cada sección: una respuesta inesperada es 502", async () => {
      for (const call of [
        () => users.getUserKyc(USER, ctx),
        () => users.getUserVehicle(USER, ctx),
        () => users.getUserDevices(USER, ctx),
        () => users.getUserModeration(USER, ctx),
      ]) {
        mockFetch(200, { inesperado: true });
        expect((await catchApiError(call())).code).toBe("USERS_SERVICE_UNAVAILABLE");
      }
    });

    it("acepta las formas válidas de kyc, vehículo y dispositivos", async () => {
      const card = { status: "approved", lastSessionId: null, attempts: [] };
      mockFetch(200, { identity: card, license: card });
      await expect(users.getUserKyc(USER, ctx)).resolves.toMatchObject({ identity: card });
      mockFetch(200, { vehicle: { brand: "Fiat", model: "Cronos", licensePlate: "AB123CD", cargoCapacityLabel: "Mediano" } });
      await expect(users.getUserVehicle(USER, ctx)).resolves.toMatchObject({ vehicle: { licensePlate: "AB123CD" } });
      mockFetch(200, { devices: [], handshakeKey: { registeredAt: "2026-10-01T00:00:00.000Z" } });
      await expect(users.getUserDevices(USER, ctx)).resolves.toMatchObject({ handshakeKey: { registeredAt: expect.any(String) } });
    });

    it("los nombres van por POST sin repetidos, y sin ids no sale a la red", async () => {
      const fetchMock = mockFetch(200, { users: [{ id: USER, fullName: "Ana Ariza", roles: ["sender", "carrier"] }] });
      await expect(users.getUserNames([USER, USER], ctx)).resolves.toEqual([{ id: USER, fullName: "Ana Ariza", roles: ["sender", "carrier"] }]);
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ ids: [USER] });

      // Un svc-users anterior a MOVO-322 no manda `roles`: no es una respuesta inválida (deploy en serie).
      mockFetch(200, { users: [{ id: USER, fullName: "Ana Ariza" }] });
      await expect(users.getUserNames([USER], ctx)).resolves.toEqual([{ id: USER, fullName: "Ana Ariza", roles: [] }]);

      const unused = mockFetch(200, { users: [] });
      await expect(users.getUserNames([], ctx)).resolves.toEqual([]);
      expect(unused).not.toHaveBeenCalled();
    });

    it("más de 200 ids se piden en lotes de a 200 (el maxItems de svc-users) y se juntan", async () => {
      const ids = Array.from({ length: 450 }, () => randomUUID());
      const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
        const { ids: chunk } = JSON.parse(init.body) as { ids: string[] };
        return { ok: true, status: 200, json: async () => ({ users: chunk.map((id) => ({ id, fullName: "Ana", roles: [] })) }) };
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const names = await users.getUserNames(ids, ctx);
      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).ids.length)).toEqual([200, 200, 50]);
      expect(names.map((n) => n.id)).toEqual(ids);
    });

    it("las acciones mandan el actor en x-user-id y relanzan el rechazo de negocio", async () => {
      const fetchMock = mockFetch(200, { revokedRefreshTokens: 3 });
      await expect(users.revokeUserSessions(USER, "admin-1", ctx)).resolves.toEqual({ revokedRefreshTokens: 3 });
      expect(fetchMock.mock.calls[0][0]).toBe(`http://users/internal/admin/users/${USER}/sessions/revoke`);
      expect(fetchMock.mock.calls[0][1].headers["x-user-id"]).toBe("admin-1");

      const result = { email: "a@movo.test", emailVerified: false, phone: "+5493511234567", phoneVerified: true, revokedRefreshTokens: 1, noticeFailed: true, sessionsRevokeFailed: false };
      mockFetch(200, result);
      await expect(users.updateUserContact(USER, { field: "email", newValue: "a@movo.test", expectedCurrent: "b@movo.test" }, "admin-1", ctx)).resolves.toEqual(result);

      mockFetch(409, { error: { code: "CONTACT_CHANGED", message: "x" } });
      const error = await catchApiError(users.updateUserContact(USER, { field: "email", newValue: "a@movo.test", expectedCurrent: "c@movo.test" }, "admin-1", ctx));
      expect([error.statusCode, error.code]).toEqual([409, "CONTACT_CHANGED"]);

      mockFetch(404, { error: { code: "USER_NOT_FOUND", message: "x" } });
      expect((await catchApiError(users.revokeUserSessions(USER, "admin-1", ctx))).code).toBe("USER_NOT_FOUND");
    });
  });

  describe("svc-shipments", () => {
    it("arma el querystring solo con los filtros presentes", async () => {
      const page = { items: [], page: 1, pageSize: 5, total: 0, counts: { sender: 0, carrier: 0, receiver: 0 } };
      const fetchMock = mockFetch(200, page);
      await expect(shipments.listUserShipments(USER, { page: 1, pageSize: 5, role: "carrier" }, ctx)).resolves.toEqual(page);
      expect(fetchMock.mock.calls[0][0]).toBe(`http://shipments/internal/admin/users/${USER}/shipments?page=1&pageSize=5&role=carrier`);
    });

    it("viajes y calificaciones validan su forma", async () => {
      mockFetch(200, { items: [{ id: "t-1", status: "active" }], page: 1, pageSize: 5, total: 1 });
      await expect(shipments.listUserTrips(USER, { page: 1, pageSize: 5 }, ctx)).resolves.toMatchObject({ total: 1 });
      mockFetch(200, { average: 4, count: 1, items: [{ score: 4, raterId: USER }], page: 1, pageSize: 5 });
      await expect(shipments.listUserRatings(USER, { page: 1, pageSize: 5 }, ctx)).resolves.toMatchObject({ average: 4 });

      mockFetch(200, { average: "4", count: 1, items: [] });
      expect((await catchApiError(shipments.listUserRatings(USER, { page: 1, pageSize: 5 }, ctx))).code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
    });

    it("un 404 (ruta que el servicio todavía no tiene) es 502, nunca una lista vacía", async () => {
      mockFetch(404, { error: { code: "NOT_FOUND", message: "Route not found" } });
      const error = await catchApiError(shipments.listUserShipments(USER, { page: 1, pageSize: 5 }, ctx));
      expect([error.statusCode, error.code]).toEqual([502, "SHIPMENTS_SERVICE_UNAVAILABLE"]);
    });
  });

  describe("svc-payments", () => {
    it("lee la tarjeta de Mercado Pago y valida el estado", async () => {
      const mp = { status: "linked", nickname: "ANA", connectedAt: "2026-10-01T00:00:00.000Z", unlinkedAt: null };
      const fetchMock = mockFetch(200, mp);
      await expect(payments.getUserMercadoPago(USER, ctx)).resolves.toEqual(mp);
      expect(fetchMock.mock.calls[0][0]).toBe(`http://payments/internal/payments/mp-connect/${USER}/admin-summary`);

      mockFetch(200, { ...mp, status: "invalid" });
      expect((await catchApiError(payments.getUserMercadoPago(USER, ctx))).code).toBe("PAYMENTS_SERVICE_UNAVAILABLE");
    });

    it("pagina la cuenta corriente con limit y cursor", async () => {
      const page = { balanceArs: 0, items: [], nextCursor: null };
      const fetchMock = mockFetch(200, page);
      await payments.getUserLedger(USER, { limit: 20, cursor: "abc" }, ctx);
      expect(fetchMock.mock.calls[0][0]).toBe(`http://payments/internal/payments/users/${USER}/admin-ledger?limit=20&cursor=abc`);
    });

    it("el ajuste va por POST con el admin como actor; el 422 se relanza", async () => {
      const response = {
        entry: { id: "e-1", type: "manual_adjustment", amountArs: 10, status: "pending", shipmentId: null, reason: "x", createdAt: "2026-10-01T00:00:00.000Z" },
        created: true,
        balanceArs: 10,
      };
      const fetchMock = mockFetch(201, response);
      const body = { idempotencyKey: "admin-adjustment:k", amountArs: 10, reason: "x", adminId: "admin-1" };
      await expect(payments.createLedgerAdjustment(USER, body, ctx)).resolves.toEqual(response);
      expect(fetchMock.mock.calls[0][0]).toBe(`http://payments/internal/payments/users/${USER}/manual-adjustments`);
      expect(fetchMock.mock.calls[0][1].headers["x-user-id"]).toBe("admin-1");

      mockFetch(422, { error: { code: "AMOUNT_OUT_OF_RANGE", message: "x" } });
      const error = await catchApiError(payments.createLedgerAdjustment(USER, body, ctx));
      expect([error.statusCode, error.code]).toEqual([422, "AMOUNT_OUT_OF_RANGE"]);
    });
  });

  // MOVO-299: sanciones (svc-users) y sus efectos (svc-shipments).
  describe("sanciones", () => {
    const SANCTION = "22222222-2222-4222-8222-222222222222";
    const sanction = {
      id: SANCTION,
      userId: USER,
      type: "suspension",
      reason: "Reportes",
      internalNote: null,
      startedAt: "2026-10-24T00:00:00.000Z",
      endsAt: null,
      appliedBy: "admin-1",
      liftedAt: null,
      liftedBy: null,
      liftReason: null,
      closedCause: null,
    };
    const withdrawal = {
      cancelledShipmentIds: [],
      withdrawnOfferIds: [],
      cancelledTripIds: [],
      stoppedRecurrenceTripIds: [],
      notifiedCounterpartyCount: 0,
      failures: [{ kind: "offer", id: "o-1" }],
    };

    it("aplicar va por POST a /internal/users/:id/sanctions con el admin como actor; el 409 se relanza", async () => {
      const fetchMock = mockFetch(201, sanction);
      await users.applySanction(USER, { type: "suspension", reason: "Reportes" }, "admin-1", ctx);
      expect(fetchMock.mock.calls[0][0]).toBe(`http://users/internal/users/${USER}/sanctions`);
      expect(fetchMock.mock.calls[0][1].headers["x-user-id"]).toBe("admin-1");

      mockFetch(409, { error: { code: "ACCOUNT_ALREADY_DISABLED", message: "x" } });
      const error = await catchApiError(users.applySanction(USER, { type: "disable", reason: "x" }, "admin-1", ctx));
      expect([error.statusCode, error.code]).toEqual([409, "ACCOUNT_ALREADY_DISABLED"]);
    });

    it("levantar convierte cualquier 404 de negocio en SANCTION_NOT_FOUND", async () => {
      mockFetch(404, { error: { code: "SANCTION_NOT_FOUND", message: "x" } });
      const error = await catchApiError(users.liftSanction(USER, SANCTION, "ok", "admin-1", ctx));
      expect([error.statusCode, error.code]).toEqual([404, "SANCTION_NOT_FOUND"]);
    });

    it("una sanción con forma inválida en el historial es 502", async () => {
      mockFetch(200, [{ ...sanction, type: "ban" }]);
      const error = await catchApiError(users.listSanctions(USER, ctx));
      expect(error.code).toBe("USERS_SERVICE_UNAVAILABLE");
    });

    it("el retiro manda el sanctionId y devuelve los `failures` (200 aunque sea parcial)", async () => {
      const fetchMock = mockFetch(200, withdrawal);
      const result = await shipments.withdrawOpenActivity(USER, SANCTION, ctx);
      expect(fetchMock.mock.calls[0][0]).toBe(`http://shipments/internal/users/${USER}/withdraw-open-activity`);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sanctionId: SANCTION });
      expect(result.failures).toEqual([{ kind: "offer", id: "o-1" }]);
    });

    it("la vista previa y los envíos en curso validan su forma; un 404 es 502", async () => {
      mockFetch(200, { shipments: 1, offers: 0, trips: 0, recurringSeries: 0, inProgressShipments: [] });
      expect((await shipments.getOpenActivity(USER, ctx)).shipments).toBe(1);

      mockFetch(200, { shipments: "1" });
      expect((await catchApiError(shipments.getOpenActivity(USER, ctx))).code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");

      mockFetch(404, { error: { code: "NOT_FOUND", message: "x" } });
      expect((await catchApiError(shipments.listInProgressShipments(USER, ctx))).code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
    });
  });
});
