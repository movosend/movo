import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@movo/shared";
import { createShipmentsClient } from "../src/adapters/shipments-client";
import { createUsersClient } from "../src/adapters/users-client";
import { createPaymentsClient } from "../src/adapters/payments-client";

const ctx = { requestId: "req-123" };
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

const parties = {
  shipmentId: "s-1",
  senderId: "u-1",
  carrierId: null,
  receiverId: "u-2",
  formerReceiverIds: [],
};

describe("clientes internos de svc-admin (MOVO-288)", () => {
  const shipments = createShipmentsClient({ SHIPMENTS_SERVICE_URL: "http://shipments" });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("propaga x-request-id y arma la URL del endpoint interno", async () => {
    const fetchMock = mockFetch(200, parties);

    await expect(shipments.getShipmentParties("s-1", ctx)).resolves.toEqual(parties);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://shipments/internal/shipments/s-1/parties");
    expect(init.headers["x-request-id"]).toBe("req-123");
    expect(init.method).toBe("GET");
  });

  it("un 404 es null: el objetivo no existe", async () => {
    mockFetch(404, { error: { code: "NOT_FOUND", message: "x" } });

    await expect(shipments.getShipmentParties("s-1", ctx)).resolves.toBeNull();
  });

  it("un 404 de ruta inexistente (formato de Fastify) es 502, no 'no existe'", async () => {
    mockFetch(404, { message: "Route GET:/internal/shipments/s-1/parties not found", error: "Not Found", statusCode: 404 });

    const error = await catchApiError(shipments.getShipmentParties("s-1", ctx));
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
  });

  it("un 404 con un código de negocio distinto del esperado es 502", async () => {
    mockFetch(404, { error: { code: "USER_NOT_FOUND", message: "x" } });

    const error = await catchApiError(shipments.getShipmentParties("s-1", ctx));
    expect(error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
  });

  it("red caída o timeout: 502 con el código del servicio (falla cerrado)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")) as unknown as typeof fetch;

    const error = await catchApiError(shipments.getShipmentParties("s-1", ctx));
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
  });

  it("un 5xx del servicio dueño es 502", async () => {
    mockFetch(500, { error: { code: "INTERNAL_ERROR", message: "x" } });

    const error = await catchApiError(createUsersClient({ USERS_SERVICE_URL: "http://users" }).getUserReportParties("r-1", ctx));
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe("USERS_SERVICE_UNAVAILABLE");
  });

  it("una respuesta con forma inesperada es 502, nunca un resultado", async () => {
    mockFetch(200, { shipmentId: "s-1" });

    const error = await catchApiError(shipments.getShipmentParties("s-1", ctx));
    expect(error.statusCode).toBe(502);
  });

  it("otro 4xx se relanza con su código y status", async () => {
    mockFetch(409, { error: { code: "ADMIN_LAST_ADMIN", message: "Es el último admin." } });

    const error = await catchApiError(
      createPaymentsClient({ PAYMENTS_SERVICE_URL: "http://payments" }).request("/internal/x", ctx, {
        method: "POST",
        body: { a: 1 },
        actorId: "admin-1",
        notFoundCodes: [],
        isValid: (_body: unknown): _body is unknown => true,
      }),
    );
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("ADMIN_LAST_ADMIN");
  });

  it("manda el cuerpo como JSON y el actor en x-user-id", async () => {
    const fetchMock = mockFetch(200, { ok: true });

    await createPaymentsClient({ PAYMENTS_SERVICE_URL: "http://payments" }).request("/internal/x", ctx, {
      method: "POST",
      body: { a: 1 },
      actorId: "admin-1",
      notFoundCodes: [],
      isValid: (_body: unknown): _body is unknown => true,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers["x-user-id"]).toBe("admin-1");
  });
});

describe("gestión de admins en el cliente de usuarios (MOVO-292)", () => {
  const users = createUsersClient({ USERS_SERVICE_URL: "http://users" });
  const admin = { id: "u-1", fullName: "Ada", email: "ada@movo.test", status: "active", photoUrl: null, grantedAt: "2026-10-01T00:00:00.000Z" };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lista admins", async () => {
    mockFetch(200, [admin]);
    expect(await users.listAdmins(ctx)).toEqual([admin]);
  });

  it("otorga con x-user-id del admin que lo pidió", async () => {
    const fetchMock = mockFetch(201, admin);
    expect(await users.grantAdmin("ada@movo.test", "admin-1", ctx)).toEqual(admin);
    const [, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string> }];
    expect(init.method).toBe("POST");
    expect(init.headers["x-user-id"]).toBe("admin-1");
  });

  it("un email sin cuenta es 404 USER_NOT_FOUND, no un 502", async () => {
    mockFetch(404, { error: { code: "USER_NOT_FOUND", message: "No existe", statusCode: 404 } });
    const error = await catchApiError(users.grantAdmin("x@movo.test", "admin-1", ctx));
    expect([error.statusCode, error.code]).toEqual([404, "USER_NOT_FOUND"]);
  });

  it("revocar acepta el 204 sin cuerpo", async () => {
    mockFetch(204);
    await expect(users.revokeAdmin("u-1", "admin-1", ctx)).resolves.toBeUndefined();
  });

  it("revocar a alguien que no es admin es 404 ADMIN_NOT_FOUND", async () => {
    mockFetch(404, { error: { code: "ADMIN_NOT_FOUND", message: "No es admin", statusCode: 404 } });
    expect((await catchApiError(users.revokeAdmin("u-1", "admin-1", ctx))).code).toBe("ADMIN_NOT_FOUND");
  });

  it("el rechazo del último admin se relanza con su código", async () => {
    mockFetch(409, { error: { code: "ADMIN_LAST_ADMIN", message: "Último admin", statusCode: 409 } });
    const error = await catchApiError(users.revokeAdmin("u-1", "admin-1", ctx));
    expect([error.statusCode, error.code]).toEqual([409, "ADMIN_LAST_ADMIN"]);
  });
});

describe("cambio forzado de estado en el cliente de envíos (MOVO-332)", () => {
  const shipments = createShipmentsClient({ SHIPMENTS_SERVICE_URL: "http://shipments" });
  const body = {
    targetStatus: "cancelled" as const,
    expectedStatus: "published" as const,
    reason: "Motivo de al menos veinte caracteres",
    adminId: "a-1",
    adminName: "Lucía Admin",
    idempotencyKey: "key-12345678",
  };
  const ok = { shipmentId: "s-1", fromStatus: "published", toStatus: "cancelled", kind: "manual", replayed: false };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("manda el cuerpo por POST con un timeout largo (el servicio llama a payments)", async () => {
    const fetchMock = mockFetch(200, ok);

    await expect(shipments.forceShipmentStatus("s-1", body, ctx)).resolves.toEqual(ok);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://shipments/internal/admin/shipments/s-1/force-status");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("un 4xx de negocio se relanza con su código y sus details", async () => {
    mockFetch(409, { error: { code: "STATUS_CHANGED", message: "cambió", statusCode: 409, details: { currentStatus: "assigned" } } });

    const error = await catchApiError(shipments.forceShipmentStatus("s-1", body, ctx));

    expect([error.statusCode, error.code, error.details]).toEqual([409, "STATUS_CHANGED", { currentStatus: "assigned" }]);
  });

  it("un 422 con details de otra forma (array) los descarta sin romper", async () => {
    mockFetch(422, { error: { code: "TRANSITION_NOT_ALLOWED", message: "no", statusCode: 422, details: ["x"] } });

    const error = await catchApiError(shipments.forceShipmentStatus("s-1", body, ctx));

    expect([error.code, error.details]).toEqual(["TRANSITION_NOT_ALLOWED", undefined]);
  });

  it("FORCE_STATUS_EFFECT_FAILED (502 de negocio) se relanza con su código y no como servicio caído", async () => {
    mockFetch(502, { error: { code: "FORCE_STATUS_EFFECT_FAILED", message: "falló un efecto", statusCode: 502 } });

    const error = await catchApiError(shipments.forceShipmentStatus("s-1", body, ctx));

    expect([error.statusCode, error.code]).toEqual([502, "FORCE_STATUS_EFFECT_FAILED"]);
  });

  it("cualquier otro 5xx sigue siendo servicio no disponible (pudo haberse aplicado)", async () => {
    mockFetch(500, { error: { code: "INTERNAL_ERROR", message: "boom", statusCode: 500 } });

    const error = await catchApiError(shipments.forceShipmentStatus("s-1", body, ctx));

    expect(error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
  });

  it("un envío inexistente es 404 NOT_FOUND", async () => {
    mockFetch(404, { error: { code: "NOT_FOUND", message: "x" } });

    const error = await catchApiError(shipments.forceShipmentStatus("s-1", body, ctx));

    expect([error.statusCode, error.code]).toEqual([404, "NOT_FOUND"]);
  });

  it("una respuesta con forma inesperada es 502, nunca un resultado", async () => {
    mockFetch(200, { shipmentId: "s-1" });

    const error = await catchApiError(shipments.forceShipmentStatus("s-1", body, ctx));

    expect(error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
  });
});

describe("step-up en el cliente de usuarios (MOVO-332)", () => {
  const users = createUsersClient({ USERS_SERVICE_URL: "http://users" });
  const action = { shipmentId: "s-1", targetStatus: "cancelled" as const };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("pedir, verificar y consumir mandan el admin en el cuerpo", async () => {
    const challenge = { challengeId: "c-1", maskedEmail: "a***@x.com", cooldownSeconds: 60, expiresInSeconds: 300 };
    let fetchMock = mockFetch(200, challenge);
    await expect(users.requestStepUp("a-1", action, ctx)).resolves.toEqual(challenge);
    expect(fetchMock.mock.calls[0][0]).toBe("http://users/internal/admin/step-up/request");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ adminId: "a-1", ...action });

    fetchMock = mockFetch(200, { stepUpToken: "t", expiresInSeconds: 300 });
    await expect(users.verifyStepUp("a-1", { ...action, challengeId: "c-1", code: "123456" }, ctx)).resolves.toEqual({
      stepUpToken: "t",
      expiresInSeconds: 300,
    });

    fetchMock = mockFetch(204);
    await expect(users.consumeStepUp("a-1", { ...action, stepUpToken: "t" }, ctx)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe("http://users/internal/admin/step-up/consume");
  });

  it("un token inválido se relanza como 401 STEP_UP_INVALID", async () => {
    mockFetch(401, { error: { code: "STEP_UP_INVALID", message: "inválido", statusCode: 401 } });

    const error = await catchApiError(users.consumeStepUp("a-1", { ...action, stepUpToken: "t" }, ctx));

    expect([error.statusCode, error.code]).toEqual([401, "STEP_UP_INVALID"]);
  });
});
