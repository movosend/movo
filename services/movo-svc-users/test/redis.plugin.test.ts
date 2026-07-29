import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import redisPlugin from "../src/plugins/redis";

describe("Redis Plugin (movo-svc-users)", () => {
  describe("Instancia principal conectada a Redis", () => {
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

    it("decora la instancia de Fastify con el cliente redis y método checkRedisHealth", () => {
      expect(app.redis).toBeDefined();
      expect(typeof app.redis.ping).toBe("function");
      expect(typeof app.checkRedisHealth).toBe("function");
    });

    it("ejecuta checkRedisHealth retornando status ok con Redis activo", async () => {
      const health = await app.checkRedisHealth();
      expect(health).toEqual({ status: "ok" });
    });

    it("permite ejecutar comandos redis correctamente (SET / GET)", async () => {
      await app.redis.set("test:movo-86", "hello", "EX", 10);
      const value = await app.redis.get("test:movo-86");
      expect(value).toBe("hello");
      await app.redis.del("test:movo-86");
    });
  });

  describe("Comportamiento ante Redis no disponible / puerto erróneo", () => {
    it("devuelve status: error en checkRedisHealth y se cierra limpiamente sin colgarse", async () => {
      const testApp = Fastify({ logger: false });
      testApp.register(redisPlugin, { redisUrl: "redis://127.0.0.1:59999" });
      await testApp.ready();

      const health = await testApp.checkRedisHealth();
      expect(health.status).toBe("error");
      expect(health.error).toBeDefined();

      // Verifica que app.close() no se cuelgue aunque Redis esté no disponible
      const closeStart = Date.now();
      await testApp.close();
      const closeDuration = Date.now() - closeStart;
      expect(closeDuration).toBeLessThan(2000);
    });

    it("falla rápidamente al iniciar si no existe configuración de REDIS_URL", async () => {
      const testApp = Fastify({ logger: false });
      const originalEnv = process.env.REDIS_URL;
      delete process.env.REDIS_URL;

      try {
        testApp.register(redisPlugin, { redisUrl: "" });
        await expect(testApp.ready()).rejects.toThrow("REDIS_URL configuration is missing for redisPlugin");
      } finally {
        if (originalEnv) {
          process.env.REDIS_URL = originalEnv;
        }
      }
    });
  });
});
