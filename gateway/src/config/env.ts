export interface EnvConfig {
  PORT: number;
  JWT_SECRET: string;
  USERS_SERVICE_URL: string;
  SHIPMENTS_SERVICE_URL: string;
  PAYMENTS_SERVICE_URL: string;
  ADMIN_SERVICE_URL: string;
  RATE_LIMIT_MAX: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

export function loadEnv(): EnvConfig {
  return {
    PORT: Number(process.env.PORT) || 3000,
    JWT_SECRET: required("JWT_SECRET"),
    USERS_SERVICE_URL:
      process.env.USERS_SERVICE_URL ?? "http://movo-svc-users:3000",
    SHIPMENTS_SERVICE_URL:
      process.env.SHIPMENTS_SERVICE_URL ?? "http://movo-svc-shipments:3000",
    PAYMENTS_SERVICE_URL:
      process.env.PAYMENTS_SERVICE_URL ?? "http://movo-svc-payments:3000",
    ADMIN_SERVICE_URL:
      process.env.ADMIN_SERVICE_URL ?? "http://movo-svc-admin:3000",
    RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX) || 200,
  };
}
