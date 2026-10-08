import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

const MP_VARS = ["MP_CLIENT_ID", "MP_CLIENT_SECRET", "MP_REDIRECT_URI", "MP_WEBHOOK_SECRET", "MP_TEST_MODE"];

describe("GET /health", () => {
  let app: FastifyInstance;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    // @fastify/env lee el .env local, pero process.env le gana: vacías acá simulan
    // un ambiente sin credenciales de MP sin depender de lo que tenga cada máquina.
    // MP_TEST_MODE va en "false" y no vacía: vacía no pasa la validación de boolean
    // (por eso compose la declara con `:-false`).
    for (const name of MP_VARS) {
      previous[name] = process.env[name];
      process.env[name] = name === "MP_TEST_MODE" ? "false" : "";
    }
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const name of MP_VARS) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });

  it("responde status ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  it("arranca sin credenciales de Mercado Pago, con MP_TEST_MODE en false", () => {
    // Se compara la presencia y no el valor: si falla, el mensaje no imprime un secreto.
    expect(Boolean(app.config.MP_CLIENT_ID)).toBe(false);
    expect(Boolean(app.config.MP_CLIENT_SECRET)).toBe(false);
    expect(app.config.MP_TEST_MODE).toBe(false);
  });
});
