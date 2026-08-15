import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export interface DbHealthResult {
  status: "ok" | "error";
  error?: string;
}

export default fp(async (app: FastifyInstance) => {
  const connectionString = process.env.DATABASE_URL;

  // El adapter de Prisma envuelve un pool de `pg` — mismos timeouts que usa
  // el plugin equivalente de movo-svc-users (MOVO-85/MOVO-93): statement_timeout/
  // query_timeout para que Postgres (o pg-pool) corte una query colgada en vez
  // de agotar el pool con clientes esperando para siempre.
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });

  const prisma = new PrismaClient({ adapter });

  const checkDbHealth = async (): Promise<DbHealthResult> => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  app.decorate("db", prisma);
  app.decorate("checkDbHealth", checkDbHealth);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    db: PrismaClient;
    checkDbHealth: () => Promise<DbHealthResult>;
  }
}
