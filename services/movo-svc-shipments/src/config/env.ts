export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  USERS_SERVICE_URL: string;
  STORAGE_PROVIDER: "mock" | "s3";
  S3_BUCKET_NAME?: string;
  S3_REGION?: string;
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
    // MOVO-81: default "mock" (mismo criterio que movo-svc-users/MOVO-97) — no depender
    // de un bucket real ni de credenciales de AWS para levantar el servicio en
    // dev/test/CI. La obligatoriedad de S3_BUCKET_NAME/S3_REGION con
    // STORAGE_PROVIDER=s3 la valida createStorageProvider al arrancar, no este schema.
    // Comparte el mismo bucket que movo-svc-users (movo-shipment-media-{env}), distinto
    // prefijo (shipments/* en vez de profile-photos/*).
    STORAGE_PROVIDER: { type: "string", enum: ["mock", "s3"], default: "mock" },
    S3_BUCKET_NAME: { type: "string" },
    S3_REGION: { type: "string" },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
