import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

describe("POST /auth/register", () => {
  let app: FastifyInstance;

  const validPayload = {
    fullName: "Juan Perez",
    email: "juan.perez@example.com",
    phone: "3511234567",
    password: "Password1",
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Aísla cada test: sin esto, el orden de ejecución hace que los tests fallen
    // de forma intermitente cuando comparten filas insertadas por otros tests.
    await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
  });

  it("da de alta un usuario exitosamente, persiste roles por defecto y no devuelve tokens ni password", async () => {
    const response = await app.inject({ method: "POST", url: "/auth/register", payload: validPayload });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { userId: string; kycStatus: string };
    expect(body).toEqual({ userId: expect.any(String), kycStatus: "not_started" });
    expect(response.body).not.toContain(validPayload.password);

    const userRow = await app.db.user.findUnique({ where: { id: body.userId } });
    expect(userRow).toMatchObject({
      email: "juan.perez@example.com",
      phone: "+5493511234567",
      firstName: "Juan",
      lastName: "Perez",
      kycStatusIdentity: "not_started",
      status: "active",
      phoneVerified: false,
    });
    expect(userRow?.passwordHash).not.toBe(validPayload.password);

    const roles = await app.db.userRoleGrant.findMany({
      where: { userId: body.userId },
      orderBy: { role: "asc" },
    });
    // MOVO-91: roles pasan a los literales de @movo/shared (UserRole.SENDER/CARRIER).
    // El ORDER BY de un enum de Postgres sigue el orden ordinal de declaración del
    // tipo ('sender','carrier','admin'), no el alfabético.
    expect(roles.map((r) => r.role)).toEqual(["sender", "carrier"]);
  });

  it("normaliza el email a minúsculas antes de persistir y de comparar (AC5)", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, email: "Juan.Perez@Example.com" },
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, phone: "3511234568", email: "juan.perez@example.com" },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(JSON.parse(duplicate.body).error.code).toBe("USER_EMAIL_ALREADY_EXISTS");
  });

  it("rechaza un email ya registrado con 409 USER_EMAIL_ALREADY_EXISTS", async () => {
    await app.inject({ method: "POST", url: "/auth/register", payload: validPayload });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, phone: "3511234568" },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("USER_EMAIL_ALREADY_EXISTS");
  });

  it("rechaza un teléfono ya registrado con 409 USER_PHONE_ALREADY_EXISTS, incluso escrito en otro formato", async () => {
    await app.inject({ method: "POST", url: "/auth/register", payload: { ...validPayload, phone: "3511234567" } });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, email: "otro@example.com", phone: "+543511234567" },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe("USER_PHONE_ALREADY_EXISTS");
  });

  it("rechaza una password débil (sin dígito) con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, password: "abcdefgh" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("rechaza una password corta con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, password: "abc123" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("rechaza un teléfono con formato inválido con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, phone: "123" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("acepta variantes válidas del formato argentino y normaliza todas al mismo E.164", async () => {
    const variants = ["3511234567", "93511234567", "+543511234567", "+5493511234567"];

    for (const [index, phone] of variants.entries()) {
      await app.db.$executeRawUnsafe("TRUNCATE TABLE users.users RESTART IDENTITY CASCADE");
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { ...validPayload, email: `variant${index}@example.com`, phone },
      });

      expect(response.statusCode).toBe(201);
      const { userId } = JSON.parse(response.body) as { userId: string };
      const row = await app.db.user.findUnique({ where: { id: userId } });
      expect(row?.phone).toBe("+5493511234567");
    }
  });

  it("rechaza un fullName de una sola palabra con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...validPayload, fullName: "Juan" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });
});
