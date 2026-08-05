import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "node:http";
import { FastifyInstance } from "fastify";
import { signAccessToken } from "@movo/shared";
import { UserRole, KycStatus } from "@movo/shared";
import { buildApp } from "../src/app";

describe("Gateway Auth Middleware", () => {
  let app: FastifyInstance;
  let stub: Server;
  let stubPort: number;
  let capturedHeaders: Record<string, string> = {};
  let capturedPath = "";

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = "redis://localhost:6379";

    // Levantar stub HTTP que captura headers y el path efectivamente reenviado —
    // esto último es lo que faltaba para detectar el bug real de rewritePrefix
    // (el stub respondía 200 a cualquier path, así que un 404 upstream por path
    // mal reescrito quedaba enmascarado; ver test "preserva el prefijo del path").
    stub = createServer((req, res) => {
      capturedHeaders = req.headers as Record<string, string>;
      capturedPath = req.url ?? "";
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

    // Apuntar todos los upstreams al stub para los tests
    process.env.SHIPMENTS_SERVICE_URL = `http://localhost:${stubPort}`;
    process.env.USERS_SERVICE_URL = `http://localhost:${stubPort}`;

    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    stub.close();
  });

  describe("Rutas protegidas (sin token)", () => {
    it("GET /shipments/* sin Authorization devuelve 401 con AUTH_TOKEN_INVALID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/shipments/123",
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("Rutas protegidas (token válido)", () => {
    it("GET /shipments/* con token válido devuelve 200 e inyecta headers", async () => {
      const token = signAccessToken({
        sub: "user-123",
        roles: [UserRole.SENDER, UserRole.CARRIER],
        kycStatus: KycStatus.APPROVED,
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/shipments/details",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);

      // Verificar headers capturados en el stub
      expect(capturedHeaders["x-user-id"]).toBe("user-123");
      expect(capturedHeaders["x-user-roles"]).toBe("sender,carrier");
      expect(capturedHeaders["x-kyc-status"]).toBe("approved");
      expect(capturedHeaders["x-request-id"]).toBeDefined();
    });
  });

  describe("Rutas protegidas (token expirado)", () => {
    it("GET /shipments/* con token expirado devuelve 401 AUTH_TOKEN_EXPIRED", async () => {
      const jwt = await import("jsonwebtoken");

      const expiredToken = jwt.sign(
        {
          sub: "user-123",
          roles: [UserRole.SENDER],
          kycStatus: KycStatus.APPROVED,
        },
        process.env.JWT_SECRET as string,
        { expiresIn: "-1s", issuer: "movo" }
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/shipments/details",
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("AUTH_TOKEN_EXPIRED");
    });
  });

  describe("Rutas protegidas (token malformado)", () => {
    it("GET /shipments/* con token malformado devuelve 401 AUTH_TOKEN_INVALID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/shipments/details",
        headers: {
          authorization: "Bearer esto-no-es-un-jwt",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("AUTH_TOKEN_INVALID");
    });
  });

  describe("Defensa contra header falsificado (x-user-id)", () => {
    it("GET /shipments/* con x-user-id falsificado en el cliente ignora el header", async () => {
      const token = signAccessToken({
        sub: "real-user-id",
        roles: [UserRole.SENDER],
        kycStatus: KycStatus.APPROVED,
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/shipments/test",
        headers: {
          authorization: `Bearer ${token}`,
          "x-user-id": "attacker-id",
        },
      });

      expect(response.statusCode).toBe(200);

      // El gateway debe inyectar el x-user-id real del token, no el falsificado
      expect(capturedHeaders["x-user-id"]).toBe("real-user-id");
      expect(capturedHeaders["x-user-id"]).not.toBe("attacker-id");
    });
  });

  describe("Rutas públicas", () => {
    it("POST /auth/register sin token devuelve 200 (público)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "test@movo.com", password: "test" },
      });

      expect(response.statusCode).toBe(200);

      // No debe inyectar headers de identidad
      expect(capturedHeaders["x-user-id"]).toBeUndefined();
    });

    it("POST /auth/register con x-user-id falsificado lo elimina también en rutas públicas", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "test@movo.com", password: "test" },
        headers: {
          "x-user-id": "attacker-id",
          "x-user-roles": "admin",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedHeaders["x-user-id"]).toBeUndefined();
      expect(capturedHeaders["x-user-roles"]).toBeUndefined();
    });

    it("POST /auth/login sin token devuelve 200 (público)", async () => {
      // IP dedicada: login tiene rate limit estricto (AC9), no queremos
      // compartir contador con el test de rate-limit ni con corridas previas.
      const testIp = `10.1.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "test@movo.com", password: "test" },
        headers: { "x-forwarded-for": testIp },
      });

      expect(response.statusCode).toBe(200);
    });

    it("POST /auth/send-otp sin token devuelve 200 (público)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-otp",
        payload: { phone: "+541234567890" },
      });

      expect(response.statusCode).toBe(200);
    });

    it("POST /auth/verify-otp sin token devuelve 200 (público)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/verify-otp",
        payload: { otpId: "otp-uuid", code: "123456" },
      });

      expect(response.statusCode).toBe(200);
    });

    it("POST /auth/resend-otp sin token devuelve 200 (público)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/resend-otp",
        payload: { otpId: "otp-uuid" },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("Preservación del path al reenviar al upstream (regresión)", () => {
    // El stub responde 200 a cualquier path, así que estos tests fallarían en
    // silencio si solo miráramos el statusCode — hay que comparar `capturedPath`
    // contra el path real que espera cada servicio (ver bug de `rewritePrefix`
    // documentado en routes/index.ts y en CLAUDE.md).
    it("GET /api/v1/shipments/123 reenvía /shipments/123 al upstream, no /123", async () => {
      const token = signAccessToken({
        sub: "user-path-test",
        roles: [UserRole.SENDER],
        kycStatus: KycStatus.APPROVED,
      });

      await app.inject({
        method: "GET",
        url: "/api/v1/shipments/123",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(capturedPath).toBe("/shipments/123");
    });

    it("POST /api/v1/auth/register reenvía /auth/register al upstream, no /register", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "path-test@movo.com", password: "test" },
      });

      expect(capturedPath).toBe("/auth/register");
    });

    it("POST /api/v1/auth/send-otp reenvía /auth/send-otp al upstream, no /send-otp", async () => {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/send-otp",
        payload: { phone: "+541234567890" },
      });

      expect(capturedPath).toBe("/auth/send-otp");
    });
  });

  describe("Rate limit estricto en login (AC9)", () => {
    it("permite 5 intentos por IP y bloquea el 6to con 429", async () => {
      // IP simulada única por corrida, para no compartir contador con el
      // resto de los tests de /auth/login ni con corridas previas.
      const testIp = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

      for (let i = 0; i < 5; i++) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email: "test@movo.com", password: "test" },
          headers: { "x-forwarded-for": testIp },
        });
        expect(response.statusCode).toBe(200);
      }

      const sixth = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "test@movo.com", password: "test" },
        headers: { "x-forwarded-for": testIp },
      });

      expect(sixth.statusCode).toBe(429);
    });
  });

  describe("GET /health", () => {
    it("GET /health devuelve 200 sin autenticación", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: "ok" });
    });
  });
});
