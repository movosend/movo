// El schema no declara ningún campo para el detalle del error. Es a propósito y
// es la segunda barrera del punto de seguridad: `checkDbHealth`/`checkRedisHealth`
// devuelven el mensaje crudo de `pg`/`ioredis`, que puede incluir usuario, host o
// puerto de la conexión. El handler lo loguea server-side y no lo pone en el body,
// pero además Fastify serializa únicamente lo declarado acá, así que un descuido
// futuro que agregue el error al objeto de respuesta igual no lo filtra.
const dependencyCheck = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "error"] },
  },
  required: ["status"],
} as const;

const healthResponse = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "error"] },
    checks: {
      type: "object",
      properties: {
        postgres: dependencyCheck,
        redis: dependencyCheck,
      },
      required: ["postgres", "redis"],
    },
  },
  required: ["status", "checks"],
} as const;

export const healthSchemas = {
  healthResponse,
};
