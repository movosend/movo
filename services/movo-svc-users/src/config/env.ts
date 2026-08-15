export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  SMS_PROVIDER: "console" | "twilio" | "telegram";
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_FROM_NUMBER?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DIDIT_MODE: "mock" | "live";
  DIDIT_BASE_URL?: string;
  DIDIT_API_KEY?: string;
  DIDIT_WORKFLOW_ID_IDENTITY?: string;
  DIDIT_WORKFLOW_ID_LICENSE?: string;
  DIDIT_WEBHOOK_SECRET?: string;
  GEOCODING_PROVIDER: "mock" | "google";
  GOOGLE_MAPS_API_KEY?: string;
  STORAGE_PROVIDER: "mock" | "s3";
  S3_BUCKET_NAME?: string;
  S3_REGION?: string;
  PUSH_PROVIDER: "mock" | "expo";
}

export const envSchema = {
  type: "object",
  required: ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"],
  properties: {
    PORT: { type: "number", default: 3000 },
    DATABASE_URL: { type: "string" },
    REDIS_URL: { type: "string" },
    JWT_SECRET: { type: "string" },
    // Default "console" (MOVO-71 AC8/guía): loguea el código, sin costo, para
    // dev/test/CI. "telegram" es exclusivo del entorno develop (ver
    // telegram-sms-provider.ts). La obligatoriedad de las credenciales de Twilio/
    // Telegram cuando se pide ese provider la valida createSmsProvider al arrancar,
    // no este schema.
    SMS_PROVIDER: { type: "string", enum: ["console", "twilio", "telegram"], default: "console" },
    TWILIO_ACCOUNT_SID: { type: "string" },
    TWILIO_API_KEY_SID: { type: "string" },
    TWILIO_API_KEY_SECRET: { type: "string" },
    TWILIO_FROM_NUMBER: { type: "string" },
    TELEGRAM_BOT_TOKEN: { type: "string" },
    TELEGRAM_CHAT_ID: { type: "string" },
    // MOVO-72: default "mock" (mismo criterio que SMS_PROVIDER=console) — no depender
    // de credenciales de sandbox de Didit.me para levantar el servicio en dev/test/CI.
    // La obligatoriedad de las otras vars cuando DIDIT_MODE=live la valida
    // createDiditClient al arrancar, no este schema.
    DIDIT_MODE: { type: "string", enum: ["mock", "live"], default: "mock" },
    DIDIT_BASE_URL: { type: "string" },
    DIDIT_API_KEY: { type: "string" },
    DIDIT_WORKFLOW_ID_IDENTITY: { type: "string" },
    // MOVO-15: workflow separado para la verificación de licencia de conducir.
    DIDIT_WORKFLOW_ID_LICENSE: { type: "string" },
    DIDIT_WEBHOOK_SECRET: { type: "string" },
    // MOVO-73: default "mock" (mismo criterio que DIDIT_MODE=mock) — el paso de mapa
    // del wizard de registro no depende de una API key de Google para levantar el
    // servicio en dev/test/CI. La obligatoriedad de GOOGLE_MAPS_API_KEY con
    // GEOCODING_PROVIDER=google la valida createGeocodingProvider al arrancar.
    GEOCODING_PROVIDER: { type: "string", enum: ["mock", "google"], default: "mock" },
    GOOGLE_MAPS_API_KEY: { type: "string" },
    // MOVO-97: default "mock" (mismo criterio que GEOCODING_PROVIDER/DIDIT_MODE/
    // SMS_PROVIDER) — no depender de un bucket real ni de credenciales de AWS para
    // levantar el servicio en dev/test/CI. La obligatoriedad de S3_BUCKET_NAME/
    // S3_REGION con STORAGE_PROVIDER=s3 la valida createStorageProvider al arrancar.
    STORAGE_PROVIDER: { type: "string", enum: ["mock", "s3"], default: "mock" },
    S3_BUCKET_NAME: { type: "string" },
    S3_REGION: { type: "string" },
    // MOVO-106: default "mock" (mismo criterio que STORAGE_PROVIDER/GEOCODING_PROVIDER/
    // DIDIT_MODE/SMS_PROVIDER) — no depender de red para levantar el servicio en
    // dev/test/CI. A diferencia de esos otros proveedores, la API pública de Expo Push
    // no requiere credenciales, así que no hay nada que `createPushNotificationProvider`
    // tenga que validar al arrancar con PUSH_PROVIDER=expo.
    PUSH_PROVIDER: { type: "string", enum: ["mock", "expo"], default: "mock" },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
