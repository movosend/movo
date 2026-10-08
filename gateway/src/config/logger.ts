import type { FastifyRequest, FastifyServerOptions } from "fastify";
import { API_PREFIX } from "./routes-map";

// Opciones de pino que acepta `Fastify({ logger })`, sin el caso `boolean`.
type LoggerOptions = Exclude<NonNullable<FastifyServerOptions["logger"]>, boolean>;

/**
 * Rutas cuyo query string no se loguea. MOVO-111 (review de PR #223): el callback de
 * OAuth de Mercado Pago recibe `?code=TG-...&state=...`. El code es de un solo uso y
 * no se puede canjear sin el `code_verifier` (que nunca sale de Redis de svc-payments),
 * pero igual no tiene por qué quedar en los logs. Mismo criterio que
 * `services/movo-svc-payments/src/config/logger.ts`.
 */
const QUERY_REDACTED_PATHS = [`${API_PREFIX}/payments/mp-connect/callback`];

export function redactUrl(url: string): string {
  const [path] = url.split("?");
  return QUERY_REDACTED_PATHS.includes(path) && url.includes("?") ? `${path}?[REDACTED]` : url;
}

export const loggerOptions: LoggerOptions = {
  serializers: {
    // Mismos campos que el serializer default de Fastify, con la URL filtrada. Un `req`
    // que no es un request de Fastify (alguien loguea `{ req: {...} }` a mano) pasa tal cual.
    req(request: FastifyRequest) {
      if (typeof request?.url !== "string") return request as unknown as Record<string, unknown>;
      return {
        method: request.method,
        url: redactUrl(request.url),
        host: request.host,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort,
      };
    },
  },
};
