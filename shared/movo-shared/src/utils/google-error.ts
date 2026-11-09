/**
 * Lo único que los adapters de Google de los servicios necesitan del logger de Fastify (pino). Estructural para no
 * depender de `fastify` acá: un `FastifyBaseLogger` lo cumple.
 */
export interface ProviderLogger {
  warn(obj: object, msg?: string): void;
}

/**
 * Status y mensaje de un rechazo de Google, para el log. Sin esto, un 502 del adapter no
 * dice si fue la key, la facturación o la API sin habilitar. Nunca incluye la URL (la
 * Geocoding API lleva la key en el query string).
 */
export interface GoogleErrorDetail {
  httpStatus: number;
  googleStatus: string | null;
  googleMessage: string | null;
}

const MAX_MESSAGE_LENGTH = 300;

export interface GoogleErrorBody {
  status?: unknown;
  error_message?: unknown;
  error?: { status?: unknown; message?: unknown };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, MAX_MESSAGE_LENGTH) : null;
}

/** Lee el body de error en sus dos formas: `{error: {status, message}}` (APIs v1/v2) y
 * `{status, error_message}` (Geocoding). Si el body no es JSON, quedan los dos en `null`. */
export async function readGoogleErrorDetail(response: Response): Promise<GoogleErrorDetail> {
  let body: GoogleErrorBody = {};
  try {
    body = (await response.json()) as GoogleErrorBody;
  } catch {
    // body vacío o no-JSON: alcanza con el status HTTP.
  }
  return googleErrorDetail(response.status, body);
}

export function googleErrorDetail(httpStatus: number, body: GoogleErrorBody): GoogleErrorDetail {
  return {
    httpStatus,
    googleStatus: asString(body.error?.status) ?? asString(body.status),
    googleMessage: asString(body.error?.message) ?? asString(body.error_message),
  };
}
