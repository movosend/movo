import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "node:http";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

// Cubre el comentario de PR sobre routes/index.ts: la duda era si Fastify
// reescribe request.url al registrar plugins con `prefix`, lo que rompería
// el strip manual de API_PREFIX usado para resolver isPublicRoute(). Estos
// tests prueban contra la app real (buildApp + inject), no la lógica en
// aislado, para verificar el comportamiento real end-to-end.
describe("Resolución de rutas bajo API_PREFIX", () => {
  let app: FastifyInstance;
  let stub: Server;
  let stubPort: number;
  let capturedUrl = "";

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = "redis://localhost:6379";

    stub = createServer((req, res) => {
      capturedUrl = req.url ?? "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      stub.listen(0, "localhost", () => {
        stubPort = (stub.address() as any).port;
        resolve();
      });
    });

    process.env.USERS_SERVICE_URL = `http://localhost:${stubPort}`;
    process.env.SHIPMENTS_SERVICE_URL = `http://localhost:${stubPort}`;

    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    stub.close();
  });

  it("reescribe el path upstream sin el API_PREFIX ni el prefijo del servicio", async () => {
    // rewritePrefix: "/" en routes/index.ts implica que el upstream recibe
    // solo lo que sigue al prefijo del servicio, sin /api/v1 ni /auth.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "test@movo.com", password: "test" },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedUrl).toBe("/register");
  });

  it("un path que sólo comparte prefijo con una ruta pública no la matchea (exige auth)", async () => {
    // isPublicRoute hace match exacto de método+path; "/auth/registerX" no es
    // "/auth/register" aunque comparta el mismo prefijo textual — no debería
    // colarse como público por un strip de prefijo mal hecho.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/registerX",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("el query string no rompe la detección de ruta pública", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register?ref=campaign",
      payload: { email: "test@movo.com", password: "test" },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedUrl).toBe("/register?ref=campaign");
  });

  it("una ruta protegida sin token en un prefijo distinto también exige auth (no público por defecto)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/shipments/abc",
    });

    expect(response.statusCode).toBe(401);
  });
});
