import type { FastifyServerOptions } from "fastify";

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
const MAX_DEPTH = 3;

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

export const loggerOptions: LoggerOptions = {
  redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
};
