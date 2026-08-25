import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "node:http";
import { FastifyInstance } from "fastify";
import { signAccessToken, UserRole, KycStatus } from "@movo/shared";
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
  let capturedHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = "redis://localhost:6379";

    stub = createServer((req, res) => {
      capturedUrl = req.url ?? "";
      capturedHeaders = req.headers;
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

  describe("Rutas de /kyc (MOVO-72, protegidas desde la revisión de PR #51)", () => {
    function issueToken(): string {
      return signAccessToken({
        sub: "11111111-1111-1111-1111-111111111111",
        roles: [UserRole.SENDER, UserRole.CARRIER],
        kycStatus: KycStatus.NOT_STARTED,
      });
    }

    it("POST /kyc/session exige token (401 sin Authorization)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/kyc/session",
      });

      expect(response.statusCode).toBe(401);
    });

    it("POST /kyc/session con token válido llega al upstream con el prefijo /kyc preservado y x-user-id inyectado", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/kyc/session",
        headers: { authorization: `Bearer ${issueToken()}` },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedUrl).toBe("/kyc/session");
      expect(capturedHeaders["x-user-id"]).toBe(
        "11111111-1111-1111-1111-111111111111",
      );
    });

    it("GET /kyc/status exige token (401 sin Authorization)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/kyc/status",
      });

      expect(response.statusCode).toBe(401);
    });

    it("GET /kyc/status con token válido llega al upstream con x-user-id inyectado", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/kyc/status",
        headers: { authorization: `Bearer ${issueToken()}` },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedUrl).toBe("/kyc/status");
      expect(capturedHeaders["x-user-id"]).toBe(
        "11111111-1111-1111-1111-111111111111",
      );
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

  describe("Rutas de /addresses (MOVO-119)", () => {
    function issueToken(): string {
      return signAccessToken({
        sub: "22222222-2222-2222-2222-222222222222",
        roles: [UserRole.SENDER, UserRole.CARRIER],
        kycStatus: KycStatus.NOT_STARTED,
      });
    }

    it("GET /addresses exige token (401 sin Authorization)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/addresses",
      });

      expect(response.statusCode).toBe(401);
    });

    it("GET /addresses con token válido llega al upstream con el prefijo /addresses preservado y x-user-id inyectado", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/addresses",
        headers: { authorization: `Bearer ${issueToken()}` },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedUrl).toBe("/addresses");
      expect(capturedHeaders["x-user-id"]).toBe(
        "22222222-2222-2222-2222-222222222222",
      );
    });
  });

  describe("Rate limit estricto en ruta protegida: POST /users/me/photo/upload-url (MOVO-97, AC8)", () => {
    // Cubre el gap real que encontró este ticket: getRateLimitOverrides() extiende el
    // mecanismo de rate limit estricto (antes solo aplicable a getPublicRoutes()) a una
    // ruta que SÍ exige JWT — sin ese cambio, esta ruta caía al límite general
    // (RATE_LIMIT_MAX/min) en vez del propio {max:20, timeWindow:"15 minutes"}.
    function issueToken(): string {
      return signAccessToken({
        sub: "33333333-3333-3333-3333-333333333333",
        roles: [UserRole.SENDER, UserRole.CARRIER],
        kycStatus: KycStatus.NOT_STARTED,
      });
    }

    it("permite 20 intentos por IP y bloquea el 21vo con 429", async () => {
      const testIp = `10.2.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const token = issueToken();

      for (let i = 0; i < 20; i++) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/users/me/photo/upload-url",
          headers: {
            authorization: `Bearer ${token}`,
            "x-forwarded-for": testIp,
          },
          payload: { contentType: "image/jpeg", contentLength: 1024 },
        });
        expect(response.statusCode).toBe(200);
      }

      const twentyFirst = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/photo/upload-url",
        headers: {
          authorization: `Bearer ${token}`,
          "x-forwarded-for": testIp,
        },
        payload: { contentType: "image/jpeg", contentLength: 1024 },
      });

      expect(twentyFirst.statusCode).toBe(429);
    });

    it("no afecta el límite general de otras rutas protegidas de /users, misma IP", async () => {
      const testIp = `10.3.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const token = issueToken();

      for (let i = 0; i < 20; i++) {
        await app.inject({
          method: "POST",
          url: "/api/v1/users/me/photo/upload-url",
          headers: {
            authorization: `Bearer ${token}`,
            "x-forwarded-for": testIp,
          },
          payload: { contentType: "image/jpeg", contentLength: 1024 },
        });
      }

      const otherRoute = await app.inject({
        method: "GET",
        url: "/api/v1/users/me",
        headers: {
          authorization: `Bearer ${token}`,
          "x-forwarded-for": testIp,
        },
      });

      expect(otherRoute.statusCode).toBe(200);
    });

    it("requiere autenticación (401 sin Authorization) — sigue siendo una ruta protegida, no pública", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users/me/photo/upload-url",
        payload: { contentType: "image/jpeg", contentLength: 1024 },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("Rate limit estricto en rutas protegidas de cambio de teléfono/email (MOVO-133, review de tmvergara)", () => {
    // Mandan SMS reales por Twilio (ADR-012) -- sin este override caían al límite
    // general (RATE_LIMIT_MAX/min), y el cooldown de otpService.generateOtp() es por
    // target, no por caller: una sola cuenta podía disparar ~200 SMS/min variando el
    // teléfono en cada request.
    function issueToken(): string {
      return signAccessToken({
        sub: "44444444-4444-4444-4444-444444444444",
        roles: [UserRole.SENDER, UserRole.CARRIER],
        kycStatus: KycStatus.NOT_STARTED,
      });
    }

    it.each([
      ["/api/v1/users/me/phone/change/otp", { phone: "3511234567" }],
      ["/api/v1/users/me/email/change/otp", { email: "nuevo@movo.test" }],
    ])("%s: permite 5 intentos por IP y bloquea el 6to con 429", async (url, payload) => {
      const testIp = `10.4.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      const token = issueToken();

      for (let i = 0; i < 5; i++) {
        const response = await app.inject({
          method: "POST",
          url,
          headers: { authorization: `Bearer ${token}`, "x-forwarded-for": testIp },
          payload,
        });
        expect(response.statusCode).toBe(200);
      }

      const sixth = await app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${token}`, "x-forwarded-for": testIp },
        payload,
      });

      expect(sixth.statusCode).toBe(429);
    });
  });

  describe("Rutas de recuperación de contraseña (MOVO-140, AC14)", () => {
    it.each([
      ["/api/v1/auth/forgot-password", "/auth/forgot-password", { identifier: "3511234567" }],
      ["/api/v1/auth/verify-reset-otp", "/auth/verify-reset-otp", { otpId: "00000000-0000-4000-8000-000000000001", code: "123456" }],
      ["/api/v1/auth/reset-password", "/auth/reset-password", { passwordResetToken: "tok", newPassword: "Password1" }],
    ])("%s es pública (sin token) y llega al upstream con el path exacto preservado", async (url, upstreamPath, payload) => {
      const response = await app.inject({ method: "POST", url, payload });

      expect(response.statusCode).toBe(200);
      expect(capturedUrl).toBe(upstreamPath);
    });

    it.each([
      "/api/v1/auth/forgot-password",
      "/api/v1/auth/verify-reset-otp",
      "/api/v1/auth/reset-password",
    ])("%s: permite 5 intentos por IP y bloquea el 6to con 429 (rate limit propio, no el general)", async (url) => {
      const testIp = `10.5.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      for (let i = 0; i < 5; i++) {
        const response = await app.inject({
          method: "POST",
          url,
          headers: { "x-forwarded-for": testIp },
          payload: {},
        });
        expect(response.statusCode).toBe(200);
      }

      const sixth = await app.inject({
        method: "POST",
        url,
        headers: { "x-forwarded-for": testIp },
        payload: {},
      });

      expect(sixth.statusCode).toBe(429);
    });

    it("un path que sólo comparte prefijo (/auth/forgot-password-x) no matchea la ruta pública (exige auth)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/forgot-password-x",
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
