import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import dbPlugin from "../src/plugins/db";

describe("Db Plugin (movo-svc-users)", () => {
  describe("Instancia principal conectada a Postgres", () => {
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

    it("decora la instancia de Fastify con el pool y método checkDbHealth", () => {
      expect(app.db).toBeDefined();
      expect(typeof app.db.query).toBe("function");
      expect(typeof app.checkDbHealth).toBe("function");
    });

    it("ejecuta checkDbHealth retornando status ok con Postgres activo", async () => {
      const health = await app.checkDbHealth();
      expect(health).toEqual({ status: "ok" });
    });

    it("fija el search_path al schema users en cada conexión", async () => {
      const result = await app.db.query("SHOW search_path");
      expect(result.rows[0].search_path).toContain("users");
    });
  });

  describe("Comportamiento ante Postgres no disponible / puerto erróneo", () => {
    it("devuelve status: error en checkDbHealth y se cierra limpiamente sin colgarse", async () => {
      const testApp = Fastify({ logger: false });
      testApp.register(dbPlugin, {
        connectionString: "postgresql://movo:movo_local_pw@127.0.0.1:59999/movo",
      });
      await testApp.ready();

      const health = await testApp.checkDbHealth();
      expect(health.status).toBe("error");
      expect(health.error).toBeDefined();

      const closeStart = Date.now();
      await testApp.close();
      const closeDuration = Date.now() - closeStart;
      expect(closeDuration).toBeLessThan(2000);
    });
  });
});
