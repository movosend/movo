import type { FastifyRequest, FastifyServerOptions } from "fastify";

// Opciones de pino que acepta `Fastify({ logger })`, sin el caso `boolean`.
type LoggerOptions = Exclude<NonNullable<FastifyServerOptions["logger"]>, boolean>;

/**
 * MOVO-267 AC6: secretos y datos de tarjeta nunca llegan a los logs. Los tokens
 * OAuth del transportista dan acceso a cobrar en su cuenta de MP, así que un log
 * que los imprima es una filtración aunque nadie lo mire.
 *
 * Se redacta en el logger (pino `redact`) y no en cada call site: cubre también
 * lo que se loguee sin pensarlo, como el objeto de un error del SDK.
 */
export const REDACTED_KEYS = [
  // OAuth de MP (MOVO-111/243)
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "client_secret",
  "clientSecret",
  "code_verifier",
  "codeVerifier",
  // Tarjeta: el backend nunca debería recibir el número (lo tokeniza el mobile),
  // pero si alguna vez llega, no se loguea. `token` es el card_token de un solo uso.
  "card_number",
  "cardNumber",
  "security_code",
  "securityCode",
  "cardholder",
  "token",
] as const;

/** Hasta qué profundidad del objeto logueado se buscan las claves de arriba. */
const MAX_DEPTH = 6;

function pathsForKey(key: string): string[] {
  return Array.from({ length: MAX_DEPTH + 1 }, (_, depth) => [...Array(depth).fill("*"), key].join("."));
}

export const REDACT_PATHS: string[] = [
  // El serializer default de Fastify no loguea headers, pero si alguien loguea el
  // request completo el JWT del usuario no tiene que aparecer.
  "req.headers.authorization",
  ...REDACTED_KEYS.flatMap(pathsForKey),
];

export const REDACT_CENSOR = "[REDACTED]";

/**
 * MOVO-111: el callback de OAuth recibe `?code=TG-...&state=...`. El code es de un solo
 * uso y sin el `code_verifier` no se puede canjear, pero igual no tiene por qué quedar
 * en los logs: se loguea el path sin el query string.
 */
const QUERY_REDACTED_PATHS = ["/payments/mp-connect/callback"];

export function redactUrl(url: string): string {
  const [path] = url.split("?");
  return QUERY_REDACTED_PATHS.includes(path) && url.includes("?") ? `${path}?[REDACTED]` : url;
}

export const loggerOptions: LoggerOptions = {
  redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
  serializers: {
    // Mismos campos que el serializer default de Fastify, con la URL filtrada. Un `req`
    // que no es un request de Fastify (alguien loguea `{ req: {...} }` a mano) pasa
    // tal cual, y lo cubre el `redact` de arriba.
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
