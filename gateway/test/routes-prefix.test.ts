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

    await new Promise<void>((resolve, reject) => {
      stub.listen(0, "localhost", () => {
        const address = stub.address();
        if (!address || typeof address === "string") {
          reject(new Error("Stub server did not return a TCP address"));
          return;
        }
        stubPort = address.port;
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

  it("reescribe el path upstream sin el API_PREFIX, pero preserva el prefijo del servicio", async () => {
    // rewritePrefix: route.prefix en routes/index.ts (MOVO-71, corrige un bug real:
    // con rewritePrefix: "/" el upstream recibía solo "/register", pero
    // movo-svc-users registra sus rutas en "/auth/register" — TODO endpoint de auth
    // devolvía 404 al pasar por el gateway real hasta este fix). El upstream recibe
    // el mismo path que expone el gateway bajo /api/v1, sin el /api/v1 en sí.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "test@movo.com", password: "test" },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedUrl).toBe("/auth/register");
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
    expect(capturedUrl).toBe("/auth/register?ref=campaign");
  });

  it("una ruta protegida sin token en un prefijo distinto también exige auth (no público por defecto)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/shipments/abc",
    });

    expect(response.statusCode).toBe(401);
  });

  describe("Rutas de /kyc (MOVO-72)", () => {
    it("POST /kyc/session es público (sin token) y llega al upstream con el prefijo /kyc preservado", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/kyc/session",
        payload: { userId: "11111111-1111-1111-1111-111111111111" },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedUrl).toBe("/kyc/session");
    });

    it("GET /kyc/status es público (sin token)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/kyc/status?userId=11111111-1111-1111-1111-111111111111",
      });

      expect(response.statusCode).toBe(200);
      expect(capturedUrl).toBe("/kyc/status?userId=11111111-1111-1111-1111-111111111111");
    });

    it("POST /kyc/webhook es público (sin token) — Didit no puede mandar un JWT", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/kyc/webhook",
        payload: { status: "Approved", session_id: "sess_1" },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedUrl).toBe("/kyc/webhook");
    });

    it("el viejo placeholder /webhooks/didit de MOVO-68 ya no existe (404, no matchea ningún prefijo de servicio)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/webhooks/didit",
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
