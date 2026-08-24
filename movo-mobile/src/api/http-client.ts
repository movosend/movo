import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { SerializedApiError } from "@movo/shared/dist/errors/api-error";
import { getApiBaseUrl } from "../lib/env";
import type { SessionResponse } from "./session-types";

/**
 * Cliente HTTP base para movo-mobile, con interceptor de sesión (MOVO-76):
 * adjunta `Authorization` automáticamente, y ante un 401 `AUTH_TOKEN_EXPIRED`
 * intenta un refresh (single-flight) y reintenta el request original una sola vez.
 *
 * Importa `@movo/shared/dist/errors/api-error` por subpath, nunca el barrel
 * `@movo/shared` (raíz) — el barrel re-exporta `auth/jwt.ts`, que depende de
 * `jsonwebtoken`/`node:crypto` y rompe el bundle de Metro/Hermes. Los módulos
 * de error y de tipos de dominio (`types/user.ts`) no tienen dependencias de
 * Node, así que son seguros de importar por subpath desde React Native.
 *
 * No importa `auth-client.ts` (evitaría un ciclo: `auth-client.ts` importa
 * `httpClient` de acá) — el refresh se dispara con `request()` directo contra
 * `/auth/refresh`, y el shape de la respuesta viene de `./session-types`, un
 * módulo sin dependencias de ninguno de los dos.
 */

const AUTH_REFRESH_PATH = "/auth/refresh";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Headers explícitos por request — p.ej. `Authorization` adjuntado a mano por
   * `authClient.logout` (MOVO-76) o `createKycSession`/`getKycStatus` (MOVO-73). Si se
   * pasa `Authorization` acá, el interceptor no lo pisa. */
  headers?: Record<string, string>;
}

export interface AuthHooks {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  /** Llamado con la sesión nueva apenas el refresh tiene éxito, antes de reintentar el
   * request original — así el store queda al día aunque el caller original no le
   * importe el resultado. */
  onTokensRefreshed: (session: SessionResponse) => Promise<void>;
  /** El refresh falló (token inválido/reusado, cuenta suspendida) — limpiar sesión y
   * mandar a login es responsabilidad de quien registra el hook (`auth-store.ts`), no
   * de esta capa. */
  onAuthFailure: () => Promise<void>;
}

let authHooks: AuthHooks | null = null;

/** `auth-store.ts` lo llama una vez al definirse — mantiene la capa de red
 * desacoplada del store de estado (Zustand) en vez de importarlo acá. */
export function registerAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${getApiBaseUrl()}/api/v1${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as SerializedApiError;
    return new ApiError(response.status, body.error.code, body.error.message);
  } catch {
    return new ApiError(response.status, "INTERNAL_ERROR", response.statusText || "Error de red");
  }
}

/**
 * Single-flight de refresh (AC5): variable de módulo, no en el store — es un detalle
 * de la capa HTTP. JS es single-threaded y esta promesa es un singleton compartido por
 * todos los imports de este archivo, así que el primer request en ver un 401 la crea
 * de forma síncrona antes de cualquier `await` posterior; cualquier otro request que
 * llegue al mismo punto (incluso en el mismo tick) ya la encuentra no-nula y la reusa
 * en vez de disparar un segundo refresh.
 */
let refreshPromise: Promise<SessionResponse> | null = null;

async function doRefresh(): Promise<SessionResponse> {
  const refreshToken = authHooks?.getRefreshToken();
  if (!refreshToken) {
    throw new ApiError(401, "AUTH_REFRESH_INVALID", "No hay sesión para refrescar.");
  }
  // `AUTH_REFRESH_PATH` hace que este request nunca dispare el flujo de refresh de sí
  // mismo (ver el chequeo de path en `request()` abajo) — sin esto, un refresh que
  // devuelve 401 entraría en loop infinito.
  const session = await request<SessionResponse>(AUTH_REFRESH_PATH, {
    method: "POST",
    body: { refreshToken },
  });
  await authHooks?.onTokensRefreshed(session);
  return session;
}

function refreshTokens(): Promise<SessionResponse> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const { method = "GET", body, query, headers } = options;
  const accessToken = headers?.Authorization ? null : (authHooks?.getAccessToken() ?? null);
  const authHeader = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const contentTypeHeader = body !== undefined ? { "Content-Type": "application/json" } : undefined;

  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers: {
        Accept: "application/json",
        ...contentTypeHeader,
        ...authHeader,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "INTERNAL_ERROR", "No se pudo conectar con el servidor. Revisá tu conexión.");
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await parseErrorBody(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<T> {
  const response = await doFetch(path, options);

  // Solo intenta refrescar si el 401 es del propio token de sesión que este cliente
  // adjuntó automáticamente (`options.headers.Authorization` ausente). Si el caller ya
  // trae su propio `Authorization` explícito (p.ej. `createKycSession`/`getKycStatus`
  // del onboarding en `use-registration.tsx`, con el token efímero del wizard, o
  // `authClient.logout`), un 401 ahí no dice nada sobre la sesión actual — no hay que
  // tocarla. Sin este chequeo, el token de onboarding (que nunca se refresca y queda
  // viejo para siempre, ver `use-registration.tsx`) dispara un refresh de la sesión real
  // en cada boot de la app; si eso corre en paralelo con otro refresh legítimo (p.ej. el
  // proactivo de `restoreSession()`), ambos usan el mismo refresh token todavía no
  // rotado y el segundo en llegar es tratado como reuso — revoca todas las sesiones del
  // usuario (rotación de un solo uso, ADR-013) y fuerza un re-login espurio.
  const usedAutoAttachedSession = !options.headers?.Authorization;

  if (
    !response.ok &&
    response.status === 401 &&
    !isRetry &&
    path !== AUTH_REFRESH_PATH &&
    usedAutoAttachedSession &&
    authHooks
  ) {
    const error = await parseErrorBody(response);
    if (error.code === "AUTH_TOKEN_EXPIRED") {
      try {
        await refreshTokens();
      } catch (refreshError) {
        // El refresh en sí falló (token inválido/reusado, cuenta suspendida) — se
        // propaga el error del refresh, no el 401 original, para que el caller sepa
        // que fue un fallo de sesión y no un error de negocio del endpoint que llamó.
        await authHooks.onAuthFailure();
        throw refreshError;
      }
      // Reintento único con el token nuevo — `isRetry: true` evita un segundo ciclo de
      // refresh si por algún motivo el retry también devuelve 401.
      return request<T>(path, options, true);
    }
    throw error;
  }

  return parseResponse<T>(response);
}

export const httpClient = {
  get: <T>(path: string, query?: RequestOptions["query"], headers?: RequestOptions["headers"]) =>
    request<T>(path, { method: "GET", query, headers }),
  post: <T>(path: string, body?: unknown, headers?: RequestOptions["headers"]) =>
    request<T>(path, { method: "POST", body, headers }),
  put: <T>(path: string, body?: unknown, headers?: RequestOptions["headers"]) =>
    request<T>(path, { method: "PUT", body, headers }),
  patch: <T>(path: string, body?: unknown, headers?: RequestOptions["headers"]) =>
    request<T>(path, { method: "PATCH", body, headers }),
  delete: <T>(path: string, body?: unknown, headers?: RequestOptions["headers"]) =>
    request<T>(path, { method: "DELETE", body, headers }),
};
