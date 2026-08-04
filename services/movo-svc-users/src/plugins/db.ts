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
    // Si Postgres cuelga en vez de responder o rechazar, un Promise.race
    // manual en el caller no libera el cliente: pool.query sigue viva y se
    // queda con un slot del pool para siempre (con max: 10, pocos healthchecks
    // colgados agotan el pool). statement_timeout hace que el propio Postgres
    // cancele la query server-side; query_timeout hace que pg-pool trate el
    // timeout como error de cliente y lo destruya/evicte (_release -> _remove
    // -> client.end()) en vez de devolverlo al pool. Revisado en MOVO-85.
    statement_timeout: 5_000,
    query_timeout: 5_000,
  });

  pool.on("error", (err) => {
    app.log.error({ err }, "Error inesperado en cliente idle del pool de Postgres");
  });

  const checkDbHealth = async (): Promise<DbHealthResult> => {
    try {
      await pool.query("SELECT 1");
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
