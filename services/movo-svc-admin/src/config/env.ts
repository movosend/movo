export interface EnvConfig {
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  USERS_SERVICE_URL: string;
  SHIPMENTS_SERVICE_URL: string;
  PAYMENTS_SERVICE_URL: string;
  SUPPORT_WS_PUBLIC_URL: string;
  SUPPORT_WS_ALLOWED_ORIGINS: string;
}

// MOVO-288: sin JWT_SECRET. Este servicio confía en los `x-user-*` que inyecta el
// gateway (ADR-010), igual que el resto; no valida tokens por su cuenta.
export const envSchema = {
  type: "object",
  required: ["DATABASE_URL", "REDIS_URL"],
  properties: {
    PORT: { type: "number", default: 3000 },
    DATABASE_URL: { type: "string" },
    REDIS_URL: { type: "string" },
    // Servicios dueños de lo que toca el panel: svc-admin aplica la regla de conflicto,
    // escribe la bitácora y llama a sus endpoints internos (decisión 6 de MOVO-286). Los
    // defaults son el nombre del servicio en movo-net, mismo criterio que svc-shipments.
    USERS_SERVICE_URL: { type: "string", default: "http://movo-svc-users:3000" },
    SHIPMENTS_SERVICE_URL: { type: "string", default: "http://movo-svc-shipments:3000" },
    PAYMENTS_SERVICE_URL: { type: "string", default: "http://movo-svc-payments:3000" },
    // MOVO-322: URL pública del WebSocket de la bandeja de soporte (la del gateway, `wss://<host>/api/v1/admin/
    // support/ws`): va en el ticket y el panel solo la acepta si es el host de su gateway. El default es el stack
    // local con nginx (`docker-compose.local.yml`).
    SUPPORT_WS_PUBLIC_URL: { type: "string", minLength: 1, default: "wss://localhost/api/v1/admin/support/ws" },
    // Orígenes del panel que pueden abrir ese WebSocket, separados por coma; `*` vale como comodín de un tramo
    // (previews de Vercel). El navegador manda `Origin` en el upgrade: es la defensa contra que otra página use un
    // ticket robado (CSWSH). Default: el panel local (`npm run dev:https`).
    SUPPORT_WS_ALLOWED_ORIGINS: { type: "string", minLength: 1, default: "https://localhost:3000" },
  },
};

declare module "fastify" {
  interface FastifyInstance {
    config: EnvConfig;
  }
}
