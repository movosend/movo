export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  USERS_SERVICE_URL: string;
}

export const envSchema = {
  type: "object",
  required: ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"],
  properties: {
    PORT: { type: "number", default: 3000 },
    DATABASE_URL: { type: "string" },
    REDIS_URL: { type: "string" },
    JWT_SECRET: { type: "string" },
    // MOVO-80: primera llamada interna servicio-a-servicio del repo (svc-shipments →
    // svc-users, para validar al receptor). Default apunta al nombre del servicio en
    // `movo-net` (infra/docker-compose.yml) — mismo criterio que ya usa el gateway
    // para este mismo var (gateway/src/config/env.ts), así que no hace falta setearlo
    // explícito en docker-compose.yml, el default ya coincide.
    USERS_SERVICE_URL: { type: "string", default: "http://movo-svc-users:3000" },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
