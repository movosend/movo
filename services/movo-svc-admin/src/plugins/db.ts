import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";

export default fp(async (app: FastifyInstance) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  app.decorate("db", pool);

  app.addHook("onClose", async () => {
    await pool.end();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}
