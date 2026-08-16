export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  USERS_SERVICE_URL: string;
  ROUTES_PROVIDER: "mock" | "google";
  GOOGLE_MAPS_API_KEY?: string;
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
    // MOVO-123: mismo criterio que GEOCODING_PROVIDER (ADR-014, movo-svc-users) — mock
    // default en dev/test/CI, no depende de una API key de Google para levantar.
    ROUTES_PROVIDER: { type: "string", enum: ["mock", "google"], default: "mock" },
    // Validada en runtime por `createRoutesProvider` cuando ROUTES_PROVIDER=google, no
    // acá — mismo criterio que GOOGLE_MAPS_API_KEY en movo-svc-users/src/config/env.ts.
    GOOGLE_MAPS_API_KEY: { type: "string" },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
