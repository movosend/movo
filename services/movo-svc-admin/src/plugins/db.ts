import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

export interface DbHealthResult {
  status: "ok" | "error";
  error?: string;
}

/** Fuera del plugin, como en svc-users (MOVO-290), para armar el cliente sin Fastify. */
export function createPrismaClient(connectionString: string | undefined): PrismaClient {
  // Mismos timeouts que el resto de los servicios Prisma (MOVO-85): Postgres (o pg-pool)
  // corta una query colgada en vez de agotar el pool.
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });

  return new PrismaClient({ adapter });
}

export default fp(async (app: FastifyInstance) => {
  const prisma = createPrismaClient(app.config?.DATABASE_URL || process.env.DATABASE_URL);

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
