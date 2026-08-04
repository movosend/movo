import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import dbPlugin from "../src/plugins/db";
import redisPlugin from "../src/plugins/redis";
import healthRoutes from "../src/modules/health/health.routes";

const PG_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Puertos donde no escucha nadie: la conexión es rechazada al toque, que es el
// modo de falla realista (proceso caído) y no cuelga la suite.
const PG_URL_DOWN = "postgresql://movo:movo_local_pw@127.0.0.1:59998/movo";
const REDIS_URL_DOWN = "redis://127.0.0.1:59999";

/** App mínima con los dos plugins apuntados a donde se le indique + la ruta real. */
async function buildHealthApp(connectionString: string, redisUrl: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(dbPlugin, { connectionString });
  app.register(redisPlugin, { redisUrl });
  app.register(healthRoutes);
  await app.ready();
  return app;
}

describe("GET /health", () => {
  describe("con ambas dependencias arriba", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      process.env.JWT_SECRET = "test-secret";
      process.env.DATABASE_URL = PG_URL;
      process.env.REDIS_URL = REDIS_URL;
      app = buildApp();
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("responde 200 con el estado de cada dependencia por separado", async () => {
      const response = await app.inject({ method: "GET", url: "/health" });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        status: "ok",
        checks: {
          postgres: { status: "ok" },
          redis: { status: "ok" },
        },
      });
    });
  });

  describe("con dependencias caídas", () => {
    it("responde 503 si solo Postgres está caído", async () => {
      const app = await buildHealthApp(PG_URL_DOWN, REDIS_URL);
      try {
        const response = await app.inject({ method: "GET", url: "/health" });
        const body = JSON.parse(response.body);

        expect(response.statusCode).toBe(503);
        expect(body.status).toBe("error");
        expect(body.checks.postgres.status).toBe("error");
        expect(body.checks.redis.status).toBe("ok");
      } finally {
        await app.close();
      }
    });

    it("responde 503 si solo Redis está caído", async () => {
      const app = await buildHealthApp(PG_URL, REDIS_URL_DOWN);
      try {
        const response = await app.inject({ method: "GET", url: "/health" });
        const body = JSON.parse(response.body);

        expect(response.statusCode).toBe(503);
        expect(body.status).toBe("error");
        expect(body.checks.postgres.status).toBe("ok");
        expect(body.checks.redis.status).toBe("error");
      } finally {
        await app.close();
      }
    });

    it("responde 502 si las dos están caídas", async () => {
      const app = await buildHealthApp(PG_URL_DOWN, REDIS_URL_DOWN);
      try {
        const response = await app.inject({ method: "GET", url: "/health" });
        const body = JSON.parse(response.body);

        expect(response.statusCode).toBe(502);
        expect(body.status).toBe("error");
        expect(body.checks.postgres.status).toBe("error");
        expect(body.checks.redis.status).toBe("error");
      } finally {
        await app.close();
      }
    });
  });

  // `/health` no lleva autenticación (lo consultan Docker y el load balancer),
  // así que el body no puede exponer nada de la conexión. Los mensajes crudos de
  // pg/ioredis traen host, puerto y a veces el usuario.
  describe("no filtra detalles de la conexión", () => {
    it("con las dos caídas, el body no trae mensajes de error ni datos de conexión", async () => {
      const app = await buildHealthApp(PG_URL_DOWN, REDIS_URL_DOWN);
      try {
        const response = await app.inject({ method: "GET", url: "/health" });
        const body = JSON.parse(response.body);

        expect(body.checks.postgres).not.toHaveProperty("error");
        expect(body.checks.redis).not.toHaveProperty("error");
        expect(body).not.toHaveProperty("error");

        expect(response.body).not.toContain("59998");
        expect(response.body).not.toContain("59999");
        expect(response.body).not.toContain("127.0.0.1");
        expect(response.body).not.toContain("movo_local_pw");
        expect(response.body).not.toMatch(/ECONNREFUSED/i);
      } finally {
        await app.close();
      }
    });
  });
});
