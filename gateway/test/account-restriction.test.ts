import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, Server } from "node:http";
import { FastifyInstance } from "fastify";
import { signAccessToken, accountRestrictionKey, UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { isSuspendedBlockedRoute } from "../src/config/routes-map";

// MOVO-298: suspensión e inhabilitación a partir de la marca en Redis, contra la app real
// (buildApp + inject) con un stub como upstream.
describe("Restricciones de cuenta (MOVO-298)", () => {
  let app: FastifyInstance;
  let stub: Server;
  const userId = "33333333-3333-3333-3333-333333333333";

  function token(): string {
    return signAccessToken({ sub: userId, roles: [UserRole.SENDER, UserRole.CARRIER], kycStatus: KycStatus.APPROVED });
  }

  function call(method: "GET" | "POST" | "PATCH", url: string) {
    return app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${token()}` }, payload: method === "GET" ? undefined : {} });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = "redis://localhost:6379";
    stub = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await new Promise<number>((resolve) => {
      stub.listen(0, "localhost", () => resolve((stub.address() as { port: number }).port));
    });
    for (const name of ["USERS", "SHIPMENTS", "PAYMENTS", "ADMIN"]) {
      process.env[`${name}_SERVICE_URL`] = `http://localhost:${port}`;
    }
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    stub.close();
  });

  beforeEach(async () => {
    await app.redis.del(accountRestrictionKey(userId));
  });

  const blocked: Array<["POST" | "PATCH", string]> = [
    ["POST", "/shipments"],
    ["POST", "/shipments/quote"],
    ["POST", "/shipments/abc/offers"],
    ["PATCH", "/offers/abc"],
    ["POST", "/offers/abc/accept"],
    ["POST", "/trips"],
    ["POST", "/shipments/abc/receiver-transfer"],
    ["POST", "/shipments/abc/accept"],
    ["POST", "/receiver-transfers/abc/accept"],
  ];

  it.each(blocked)("suspendida con fin: %s %s responde 403 ACCOUNT_SUSPENDED con endsAt", async (method, url) => {
    await app.redis.set(accountRestrictionKey(userId), "suspended", "PX", 60_000);
    const response = await call(method, url);
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("ACCOUNT_SUSPENDED");
    const endsAt = new Date(body.error.details.endsAt).getTime();
    expect(endsAt).toBeGreaterThan(Date.now() + 30_000);
    expect(endsAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("suspendida sin fin: endsAt es null", async () => {
    await app.redis.set(accountRestrictionKey(userId), "suspended");
    const response = await call("POST", "/trips");
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.details).toEqual({ endsAt: null });
  });

  it.each([
    ["POST", "/shipments/abc/handshake/confirm"],
    ["POST", "/shipments/abc/positions"],
    ["POST", "/shipments/abc/cancel"],
    ["POST", "/shipments/abc/receiver"],
    ["POST", "/offers/abc/reject"],
    ["PATCH", "/trips/abc"],
    ["GET", "/shipments/abc"],
  ] as const)("suspendida: %s %s pasa", async (method, url) => {
    await app.redis.set(accountRestrictionKey(userId), "suspended", "PX", 60_000);
    const response = await call(method, url);
    expect(response.statusCode).toBe(200);
  });

  it.each([
    ["GET", "/shipments/abc"],
    ["POST", "/shipments/abc/positions"],
    ["POST", "/trips"],
    ["GET", "/users/me"],
  ] as const)("inhabilitada: %s %s responde 403 ACCOUNT_DISABLED", async (method, url) => {
    await app.redis.set(accountRestrictionKey(userId), "disabled");
    const response = await call(method, url);
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("ACCOUNT_DISABLED");
  });

  it("la marca vencida por TTL deja de bloquear", async () => {
    await app.redis.set(accountRestrictionKey(userId), "suspended", "PX", 100);
    expect((await call("POST", "/trips")).statusCode).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await call("POST", "/trips")).statusCode).toBe(200);
  });

  it("sin marca no bloquea nada", async () => {
    expect((await call("POST", "/trips")).statusCode).toBe(200);
  });

  it("falla abierto si Redis no responde", async () => {
    const original = app.redis.multi.bind(app.redis);
    app.redis.multi = (() => {
      throw new Error("Redis caído");
    }) as unknown as typeof app.redis.multi;
    try {
      expect((await call("POST", "/trips")).statusCode).toBe(200);
    } finally {
      app.redis.multi = original;
    }
  });

  it("el matcher no confunde paths parecidos", () => {
    expect(isSuspendedBlockedRoute("POST", "/shipments/abc/offers/extra")).toBe(false);
    expect(isSuspendedBlockedRoute("GET", "/trips")).toBe(false);
    expect(isSuspendedBlockedRoute("post", "/trips/")).toBe(true);
  });
});
