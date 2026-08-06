import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";

describe("GET /kyc/status (MOVO-72, AC8)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  async function createUser(kycStatusIdentity: string): Promise<string> {
    const user = await app.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        phone: `+549351${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: "Juan",
        lastName: "Perez",
        passwordHash: "hash",
        phoneVerified: true,
        kycStatusIdentity: kycStatusIdentity as "not_started" | "pending" | "approved" | "rejected" | "expired" | "manual_review",
      },
    });
    return user.id;
  }

  it("devuelve not_started para un usuario recién creado, sin manualReviewReason", async () => {
    const userId = await createUser("not_started");

    const response = await app.inject({ method: "GET", url: `/kyc/status?userId=${userId}` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "not_started", manualReviewReason: null });
  });

  it("devuelve pending mientras la sesión está en curso", async () => {
    const userId = await createUser("pending");

    const response = await app.inject({ method: "GET", url: `/kyc/status?userId=${userId}` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("pending");
  });

  it("devuelve approved luego de resuelto el webhook", async () => {
    const userId = await createUser("approved");

    const response = await app.inject({ method: "GET", url: `/kyc/status?userId=${userId}` });

    expect(JSON.parse(response.body).status).toBe("approved");
  });

  it("devuelve manual_review con el motivo del intento más reciente (raw_decision.warnings, MOVO-72 Paso 7)", async () => {
    const userId = await createUser("manual_review");
    await app.db.kycVerification.create({
      data: {
        userId,
        verificationType: "identity",
        provider: "didit",
        externalSessionId: `sess-${randomUUID()}`,
        status: "manual_review",
        resolvedAt: new Date(),
        // Shape real de extractDecisionWarnings (kyc.service.ts) sobre un payload de
        // Didit confirmado contra el sandbox (Paso 7 del plan).
        rawDecision: {
          status: "In Review",
          warnings: [{ feature: "ID_VERIFICATION", risk: "DOCUMENT_EXPIRED", description: "Document expired" }],
        },
      },
    });

    const response = await app.inject({ method: "GET", url: `/kyc/status?userId=${userId}` });

    expect(JSON.parse(response.body)).toEqual({
      status: "manual_review",
      manualReviewReason: "Document expired",
    });
  });

  it("varios warnings se unen en un solo string separados por '; '", async () => {
    const userId = await createUser("manual_review");
    await app.db.kycVerification.create({
      data: {
        userId,
        verificationType: "identity",
        provider: "didit",
        externalSessionId: `sess-${randomUUID()}`,
        status: "manual_review",
        resolvedAt: new Date(),
        rawDecision: {
          status: "In Review",
          warnings: [
            { feature: "ID_VERIFICATION", risk: "DOCUMENT_EXPIRED", description: "Document expired" },
            { feature: "FACE_MATCH", risk: "LOW_SCORE", description: "Face match score too low" },
          ],
        },
      },
    });

    const response = await app.inject({ method: "GET", url: `/kyc/status?userId=${userId}` });

    expect(JSON.parse(response.body).manualReviewReason).toBe("Document expired; Face match score too low");
  });

  it("manual_review sin warnings en raw_decision devuelve manualReviewReason: null (no revienta) — confirmado con el payload real de ejemplo de In Review, que no trae ninguno", async () => {
    const userId = await createUser("manual_review");
    await app.db.kycVerification.create({
      data: {
        userId,
        verificationType: "identity",
        provider: "didit",
        externalSessionId: `sess-${randomUUID()}`,
        status: "manual_review",
        resolvedAt: new Date(),
        rawDecision: { status: "In Review" },
      },
    });

    const response = await app.inject({ method: "GET", url: `/kyc/status?userId=${userId}` });

    expect(JSON.parse(response.body)).toEqual({ status: "manual_review", manualReviewReason: null });
  });

  it("devuelve 404 NOT_FOUND si el usuario no existe", async () => {
    const response = await app.inject({ method: "GET", url: `/kyc/status?userId=${randomUUID()}` });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("NOT_FOUND");
  });

  it("rechaza un userId con formato inválido (no uuid) con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({ method: "GET", url: "/kyc/status?userId=no-es-un-uuid" });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });
});
