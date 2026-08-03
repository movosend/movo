import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { SerializedApiError } from "@movo/shared/dist/errors/api-error";
import { getApiBaseUrl } from "../lib/env";

/**
 * Cliente HTTP base para movo-mobile. Deliberadamente **sin** lógica de
 * autenticación (adjuntar `Authorization`, refresh en 401, single-flight):
 * eso es alcance de MOVO-76, que extiende este archivo.
 *
 * Importa `@movo/shared/dist/errors/api-error` por subpath, nunca el barrel
 * `@movo/shared` (raíz) — el barrel re-exporta `auth/jwt.ts`, que depende de
 * `jsonwebtoken`/`node:crypto` y rompe el bundle de Metro/Hermes. Los módulos
 * de error y de tipos de dominio (`types/user.ts`) no tienen dependencias de
 * Node, así que son seguros de importar por subpath desde React Native.
 */

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
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

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "INTERNAL_ERROR", "No se pudo conectar con el servidor. Revisá tu conexión.");
  }

  if (!response.ok) {
    throw await parseErrorBody(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const httpClient = {
  get: <T>(path: string, query?: RequestOptions["query"]) => request<T>(path, { method: "GET", query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
};
