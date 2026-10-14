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
      isValid: (_body: unknown): _body is unknown => true,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers["x-user-id"]).toBe("admin-1");
  });
});
