import { ApiError, ApiErrorCode } from "@movo/shared";

/** Datos del request del panel que viajan a cada llamada interna. */
export interface RequestContext {
  /** `x-request-id` del gateway: se propaga para seguir una acción del panel entre servicios (ADR-001). */
  requestId: string;
}

export interface InternalRequestOptions<T> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Header `x-user-id` para los endpoints internos que registran quién pidió la operación. */
  actorId?: string;
  timeoutMs?: number;
  /**
   * Códigos de negocio con los que el servicio dueño responde 404 cuando el objetivo no existe.
   * Un 404 con otro código (o sin cuerpo de `ApiError`) es una ruta que el servicio todavía no
   * tiene, p. ej. en un deploy en serie, y se trata como servicio no disponible.
   */
  notFoundCodes: readonly string[];
  /**
   * Códigos de negocio que el servicio dueño responde con un 5xx pero que NO son una caída: el pedido
   * llegó y se rechazó con un motivo conocido (p. ej. `FORCE_STATUS_EFFECT_FAILED`, 502). Se relanzan
   * con su código en vez de colapsar en `<SERVICIO>_SERVICE_UNAVAILABLE`, que la bitácora toma por
   * "pudo haberse aplicado".
   */
  relayServerErrorCodes?: readonly string[];
  /** Valida la forma de la respuesta: una forma inesperada nunca se lee como resultado. */
  isValid: (body: unknown) => body is T;
}

/**
 * Cliente base hacia los endpoints internos de un servicio dueño (decisión 6 de MOVO-286:
 * `svc-admin` aplica la regla de conflicto y la bitácora, y delega la acción). Cada US de
 * admin suma sus métodos en el cliente del servicio que corresponda, sobre este `request`.
 */
export interface InternalClient {
  /**
   * `null` ante un 404 con uno de los `notFoundCodes` (el objetivo no existe: resultado de
   * negocio, no una falla). Falla cerrado con 502 `<SERVICIO>_SERVICE_UNAVAILABLE` ante red
   * caída, timeout, 5xx, una respuesta con forma inválida o un 404 con otro código. Cualquier otro 4xx se relanza con su código y status.
   */
  request<T>(path: string, ctx: RequestContext, opts: InternalRequestOptions<T>): Promise<T | null>;
}

export interface InternalClientConfig {
  baseUrl: string;
  /** Para los mensajes de error: "usuarios", "envíos", "pagos". */
  serviceLabel: string;
  unavailableCode: ApiErrorCode;
}

const DEFAULT_TIMEOUT_MS = 5000;

type SerializedError = { error?: { code?: unknown; message?: unknown; details?: unknown } };

/** Los `details` de un error del servicio dueño viajan al panel (p. ej. `currentStatus` de un 409). */
const detailsOf = (body: SerializedError): Record<string, unknown> | undefined => {
  const details = body.error?.details;
  return typeof details === "object" && details !== null && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : undefined;
};

export function createInternalClient(config: InternalClientConfig): InternalClient {
  const unavailable = (detail: string) =>
    new ApiError(502, config.unavailableCode, `El servicio de ${config.serviceLabel} ${detail}.`);

  return {
    async request<T>(path: string, ctx: RequestContext, opts: InternalRequestOptions<T>): Promise<T | null> {
      const headers: Record<string, string> = { "x-request-id": ctx.requestId };
      if (opts.body !== undefined) headers["content-type"] = "application/json";
      if (opts.actorId) headers["x-user-id"] = opts.actorId;

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}${path}`, {
          method: opts.method ?? "GET",
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch {
        throw unavailable("no responde");
      }

      if (!response.ok) {
        let body: SerializedError = {};
        try {
          body = (await response.json()) as SerializedError;
        } catch {
          // cuerpo no JSON: se trata como respuesta inválida.
        }
        if (response.status >= 500) {
          const code = body.error?.code;
          if (typeof code === "string" && opts.relayServerErrorCodes?.includes(code)) {
            const message = typeof body.error?.message === "string" ? body.error.message : "Error del servicio.";
            throw new ApiError(response.status, code as ApiErrorCode, message, detailsOf(body));
          }
          throw unavailable("devolvió un error");
        }
        if (typeof body.error?.code !== "string") throw unavailable("devolvió una respuesta inválida");
        if (response.status === 404) {
          if (opts.notFoundCodes.includes(body.error.code)) return null;
          throw unavailable("no tiene este endpoint");
        }
        const message = typeof body.error.message === "string" ? body.error.message : "Error del servicio.";
        throw new ApiError(response.status, body.error.code as ApiErrorCode, message, detailsOf(body));
      }

      // 204: sin cuerpo (p. ej. un DELETE). `isValid` decide si `undefined` es una respuesta válida.
      if (response.status === 204) {
        if (!opts.isValid(undefined)) throw unavailable("devolvió una respuesta inválida");
        // Solo llega acá si `isValid(undefined)` pasó, o sea que `T` admite `undefined`.
        return undefined as T;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw unavailable("devolvió una respuesta inválida");
      }
      if (!opts.isValid(body)) throw unavailable("devolvió una respuesta inválida");
      return body;
    },
  };
}

// Guardas chicas para validar respuestas sin traer una librería de schemas.
export const isString = (value: unknown): value is string => typeof value === "string";
export const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
export const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
