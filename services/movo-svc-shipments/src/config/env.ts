export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  USERS_SERVICE_URL: string;
  STORAGE_PROVIDER: "mock" | "s3";
  S3_BUCKET_NAME?: string;
  S3_REGION?: string;
  ROUTES_PROVIDER: "mock" | "google";
  GOOGLE_MAPS_API_KEY?: string;
  RECEIVER_CONFIRMATION_TIMEOUT_HOURS: number;
  RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES: number;
  RECEIVER_CONFIRMATION_SWEEP_ENABLED?: boolean;
  ORPHAN_PHOTO_RETENTION_HOURS: number;
  ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: number;
  ORPHAN_PHOTO_SWEEP_ENABLED?: boolean;
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
    // MOVO-123: mismo criterio que GEOCODING_PROVIDER (ADR-014, movo-svc-users) — mock
    // default en dev/test/CI, no depende de una API key de Google para levantar.
    ROUTES_PROVIDER: { type: "string", enum: ["mock", "google"], default: "mock" },
    // Validada en runtime por `createRoutesProvider` cuando ROUTES_PROVIDER=google, no
    // acá — mismo criterio que GOOGLE_MAPS_API_KEY en movo-svc-users/src/config/env.ts.
    GOOGLE_MAPS_API_KEY: { type: "string" },
    // MOVO-130: plazo en horas para que el receptor acepte/rechace antes de que el envío expire.
    RECEIVER_CONFIRMATION_TIMEOUT_HOURS: { type: "number", default: 48 },
    // MOVO-130: intervalo en minutos del barrido periódico de expiración.
    RECEIVER_CONFIRMATION_SWEEP_INTERVAL_MINUTES: { type: "number", default: 15 },
    // MOVO-130: flag para habilitar/deshabilitar el barrido periódico (útil en test/CI).
    RECEIVER_CONFIRMATION_SWEEP_ENABLED: { type: "boolean", default: true },
    // MOVO-124: ventana desde el presign antes de considerar huérfana una key nunca
    // confirmada (mismo criterio sugerido por el ticket). No se ata al TTL de la
    // presigned URL (300s, solo acota el PUT) porque la confirmación puede demorar
    // mucho más que la subida -- el cliente puede subir la foto y recién confirmar
    // en una sesión posterior.
    ORPHAN_PHOTO_RETENTION_HOURS: { type: "number", default: 24 },
    // MOVO-124: intervalo en minutos del barrido de fotos huérfanas.
    ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES: { type: "number", default: 60 },
    // MOVO-124: flag para habilitar/deshabilitar el barrido (útil en test/CI), mismo
    // criterio que RECEIVER_CONFIRMATION_SWEEP_ENABLED.
    ORPHAN_PHOTO_SWEEP_ENABLED: { type: "boolean", default: true },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
