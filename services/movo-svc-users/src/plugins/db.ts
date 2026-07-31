import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";

export interface DbPluginOptions {
  connectionString?: string;
}

export interface DbHealthResult {
  status: "ok" | "error";
  error?: string;
}

export default fp<DbPluginOptions>(async (app: FastifyInstance, opts: DbPluginOptions) => {
  const connectionString = opts.connectionString || app.config?.DATABASE_URL || process.env.DATABASE_URL;

  const pool = new Pool({
    connectionString,
    // Fija el search_path como parámetro de arranque de la conexión (no una
    // query aparte tras conectar): Postgres lo aplica de forma atómica en el
    // handshake, evitando la carrera con la primera query real del pool.
    options: "-c search_path=users,public",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on("error", (err) => {
    app.log.error({ err }, "Error inesperado en cliente idle del pool de Postgres");
  });

  const checkDbHealth = async (): Promise<DbHealthResult> => {
    try {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Postgres health check timeout")), 2000)
        ),
      ]);
      return { status: "ok" };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  app.decorate("db", pool);
  app.decorate("checkDbHealth", checkDbHealth);

  app.addHook("onClose", async () => {
    await pool.end();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
    checkDbHealth: () => Promise<DbHealthResult>;
  }
}
