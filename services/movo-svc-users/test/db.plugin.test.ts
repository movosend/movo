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

    it("decora la instancia de Fastify con el PrismaClient y método checkDbHealth", () => {
      expect(app.db).toBeDefined();
      expect(typeof app.db.$queryRaw).toBe("function");
      expect(typeof app.db.user.findMany).toBe("function");
      expect(typeof app.checkDbHealth).toBe("function");
    });

    it("ejecuta checkDbHealth retornando status ok con Postgres activo", async () => {
      const health = await app.checkDbHealth();
      expect(health).toEqual({ status: "ok" });
    });

    it("resuelve queries contra el schema users sin depender de search_path (multi-schema de Prisma)", async () => {
      // A diferencia del Pool de `pg` (que fijaba `search_path=users,public` como
      // opción de conexión), Prisma con `schemas = ["users"]` genera SQL con el
      // schema calificado (`"users"."users"`) en cada query -- no depende del
      // search_path de la sesión. Que esto no tire error ya prueba que resuelve bien.
      await expect(app.db.user.count()).resolves.toEqual(expect.any(Number));
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
