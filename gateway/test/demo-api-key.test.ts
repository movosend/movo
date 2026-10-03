import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, Server } from "node:http";
import { FastifyInstance } from "fastify";
import { signAccessToken, UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";

// Juegos de movo-institucional: el prefijo /demo se autentica con API key
// (`DEMO_API_KEYS`), no con JWT. Contra la app real (buildApp + inject) y un stub de
// upstream, mismo criterio que routes-prefix.test.ts.
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const SESSION_ID = "6f1c2a7e-0b55-4d3a-9b1e-2f7d8c9a0b11";

describe("Prefijo /demo con API key", () => {
  let app: FastifyInstance;
  let stub: Server;
  let capturedUrl = "";
  let capturedHeaders: Record<string, string | string[] | undefined> = {};
  let hits = 0;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.DEMO_API_KEYS = `${KEY_A}, ${KEY_B}`;

    stub = createServer((req, res) => {
      hits += 1;
      capturedUrl = req.url ?? "";
      capturedHeaders = req.headers;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await new Promise<number>((resolve, reject) => {
      stub.listen(0, "localhost", () => {
        const address = stub.address();
        if (!address || typeof address === "string") {
          reject(new Error("Stub server did not return a TCP address"));
          return;
        }
        resolve(address.port);
      });
    });
    process.env.USERS_SERVICE_URL = `http://localhost:${port}`;
    process.env.SHIPMENTS_SERVICE_URL = `http://localhost:${port}`;

    app = buildApp();
    await app.ready();
    // Contadores limpios entre corridas: las claves de rate limit viven en Redis real.
    const keys = await app.redis.keys("*demo*");
    if (keys.length) await app.redis.del(...keys);
  });

  afterAll(async () => {
    delete process.env.DEMO_API_KEYS;
    await app.close();
    stub.close();
  });

  beforeEach(() => {
    hits = 0;
    capturedHeaders = {};
  });

  it("sin x-api-key responde 401 AUTH_API_KEY_INVALID y no llega al upstream", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/demo/pricing-game/stats" });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_API_KEY_INVALID");
    expect(hits).toBe(0);
  });

  it("con una key inválida responde 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/demo/pricing-game/stats",
      headers: { "x-api-key": "c".repeat(64) },
    });

    expect(res.statusCode).toBe(401);
    expect(hits).toBe(0);
  });

  it("un JWT válido de usuario no sirve en /demo", async () => {
    const token = signAccessToken({
      sub: "11111111-1111-1111-1111-111111111111",
      roles: [UserRole.SENDER],
      kycStatus: KycStatus.APPROVED,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/demo/pricing-game/stats",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it("con key válida proxea preservando el path, inyecta x-client-id y no reenvía la key", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/demo/pricing-game/sessions/${SESSION_ID}`,
      headers: { "x-api-key": KEY_B, "x-user-id": "spoofed", "x-client-id": "demo-99" },
      payload: { completed: true },
    });

    expect(res.statusCode).toBe(200);
    expect(capturedUrl).toBe(`/demo/pricing-game/sessions/${SESSION_ID}`);
    expect(capturedHeaders["x-client-id"]).toBe("demo-2");
    expect(capturedHeaders["x-api-key"]).toBeUndefined();
    expect(capturedHeaders["x-user-id"]).toBeUndefined();
    expect(capturedHeaders["x-request-id"]).toBeDefined();
  });

  it("un x-client-id mandado por el cliente nunca llega a otras rutas", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "x-client-id": "demo-1" },
      payload: {},
    });

    expect(capturedHeaders["x-client-id"]).toBeUndefined();
  });

  it("la cotización tiene límite propio por visitante (x-movo-client-ip), no compartido", async () => {
    const quote = (ip: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/demo/pricing-game/quote",
        headers: { "x-api-key": KEY_A, "x-movo-client-ip": ip },
        payload: {},
      });

    for (let i = 0; i < 60; i += 1) {
      expect((await quote("203.0.113.7")).statusCode).toBe(200);
    }
    const blocked = await quote("203.0.113.7");
    const otherVisitor = await quote("203.0.113.8");

    expect(blocked.statusCode).toBe(429);
    expect(otherVisitor.statusCode).toBe(200);
  });

  it("crear partidas del optimizador tiene su propio límite por visitante", async () => {
    const create = (ip: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/demo/route-game/games",
        headers: { "x-api-key": KEY_A, "x-movo-client-ip": ip },
        payload: {},
      });

    for (let i = 0; i < 60; i += 1) {
      expect((await create("203.0.113.9")).statusCode).toBe(200);
    }
    expect((await create("203.0.113.9")).statusCode).toBe(429);
    expect(capturedUrl).toBe("/demo/route-game/games");
    // El ranking cuenta aparte: agotar la creación no lo bloquea.
    const ranking = await app.inject({
      method: "GET",
      url: "/api/v1/demo/route-game/ranking?eventTag=feria",
      headers: { "x-api-key": KEY_A, "x-movo-client-ip": "203.0.113.9" },
    });
    expect(ranking.statusCode).toBe(200);
  });
});

describe("Prefijo /demo sin DEMO_API_KEYS configurada", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.DEMO_API_KEYS;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rechaza cualquier key (default seguro)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/demo/pricing-game/stats",
      headers: { "x-api-key": "" },
    });

    expect(res.statusCode).toBe(401);
  });
});
