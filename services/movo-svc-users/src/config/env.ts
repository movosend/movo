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
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
