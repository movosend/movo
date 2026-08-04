import { FastifyInstance } from "fastify";
import { healthSchemas } from "./health.schema";

/**
 * Códigos de respuesta (MOVO-89, AC 3):
 * - 200 si Postgres y Redis responden.
 * - 503 si falla **una** de las dos: el servicio sigue de pie a medias.
 * - 502 si fallan **las dos**: no puede operar.
 *
 * Para el `HEALTHCHECK` de Docker los dos códigos de error son equivalentes
 * (cualquier respuesta no-2xx cuenta como fallo); la distinción existe para que
 * un humano leyendo logs o un panel de monitoreo separe de un vistazo "una pata
 * rota" de "no hay nada en pie".
 */
const HTTP_OK = 200;
const HTTP_ONE_DEPENDENCY_DOWN = 503;
const HTTP_BOTH_DEPENDENCIES_DOWN = 502;

export default async function healthRoutes(app: FastifyInstance) {
  app.get(
    "/health",
    {
      schema: {
        description:
          "Estado de conectividad del servicio y sus dependencias (PostgreSQL y Redis).",
        response: {
          [HTTP_OK]: healthSchemas.healthResponse,
          [HTTP_ONE_DEPENDENCY_DOWN]: healthSchemas.healthResponse,
          [HTTP_BOTH_DEPENDENCIES_DOWN]: healthSchemas.healthResponse,
        },
      },
    },
    async (_request, reply) => {
      // En paralelo y no en serie: la latencia total es la del check más lento
      // y no la suma de ambos (AC 2). Ninguna de las dos funciones rechaza
      // —devuelven `{ status: "error" }`—, así que `Promise.all` no corta.
      const [postgres, redis] = await Promise.all([app.checkDbHealth(), app.checkRedisHealth()]);

      const downCount = Number(postgres.status === "error") + Number(redis.status === "error");

      // El detalle del error se loguea acá y no viaja en la respuesta: los
      // mensajes de `pg`/`ioredis` pueden incluir usuario, host o puerto de la
      // conexión, y `/health` es consultado por el healthcheck de Docker y el
      // load balancer sin autenticación.
      if (downCount > 0) {
        app.log.error(
          { postgresError: postgres.error, redisError: redis.error },
          "Healthcheck con dependencias caidas"
        );
      }

      const statusCode =
        downCount === 0
          ? HTTP_OK
          : downCount === 1
            ? HTTP_ONE_DEPENDENCY_DOWN
            : HTTP_BOTH_DEPENDENCIES_DOWN;

      return reply.code(statusCode).send({
        status: downCount === 0 ? "ok" : "error",
        checks: {
          postgres: { status: postgres.status },
          redis: { status: redis.status },
        },
      });
    }
  );
}
