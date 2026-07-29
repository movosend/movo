import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

describe("Redis Plugin (movo-svc-users)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("decora la instancia de Fastify con el cliente redis y método checkRedisHealth", () => {
    expect(app.redis).toBeDefined();
    expect(typeof app.redis.ping).toBe("function");
    expect(typeof app.checkRedisHealth).toBe("function");
  });

  it("ejecuta checkRedisHealth retornando un resultado estructurado de salud", async () => {
    const health = await app.checkRedisHealth();
    expect(health).toHaveProperty("status");
    expect(["ok", "error"]).toContain(health.status);
  });
});
