import "server-only"
import { randomUUID } from "node:crypto"
import { headers } from "next/headers"
import {
  ApiError,
  type SerializedApiError,
} from "@movo/shared/src/errors/api-error"

export const gatewayBaseUrl = () =>
  process.env.MOVO_GATEWAY_URL ?? "https://api-dev.movosend.app"

type GatewayOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
  accessToken?: string
  idempotencyKey?: string
  timeoutMs?: number
}

/**
 * Único camino al gateway: arma el request (request-id, bearer, `no-store`, `redirect: "error"`,
 * timeout) y mapea los errores a `ApiError`. `gateway()` y `gatewayFile()` solo difieren en cómo
 * leen el cuerpo de una respuesta buena, así un arreglo acá llega a las dos.
 */
async function gatewayRequest<T>(
  path: string,
  options: GatewayOptions,
  parse: (response: Response) => Promise<T>
): Promise<T> {
  const requestId = (await headers()).get("x-request-id") || randomUUID()
  let response: Response
  try {
    response = await fetch(`${gatewayBaseUrl()}/api/v1${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        "x-request-id": requestId,
        ...(options.accessToken
          ? { Authorization: `Bearer ${options.accessToken}` }
          : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
      redirect: "error",
    })
  } catch {
    throw new ApiError(
      503,
      "INTERNAL_ERROR",
      "No pudimos conectar con Movo. Reintentá en unos momentos."
    )
  }
  if (!response.ok) {
    const result = (await response
      .json()
      .catch(() => null)) as SerializedApiError | null
    throw new ApiError(
      response.status,
      result?.error?.code ?? "INTERNAL_ERROR",
      "La solicitud no pudo completarse.",
      result?.error?.details
    )
  }
  return parse(response)
}

export const gateway = <T>(path: string, options: GatewayOptions = {}) =>
  gatewayRequest<T>(path, options, (response) =>
    response.status === 204
      ? Promise.resolve(undefined as T)
      : (response.json() as Promise<T>)
  )

/**
 * Un archivo del gateway (CSV de los reportes, MOVO-345). Devuelve los bytes, no un string:
 * `Response.text()` descarta el BOM que `svc-admin` antepone para que Excel abra el CSV en UTF-8.
 */
export const gatewayFile = (
  path: string,
  options: { accessToken?: string } = {}
) =>
  gatewayRequest(path, { ...options, timeoutMs: 30000 }, async (response) => ({
    body: new Uint8Array(await response.arrayBuffer()),
    headers: response.headers,
  }))

const ADMIN_REASONS: Record<string, string> = {
  USER_NOT_FOUND:
    "No hay una cuenta con ese email. La persona tiene que registrarse primero en la app.",
  ADMIN_GRANT_EMAIL_NOT_VERIFIED:
    "Esa cuenta no verificó su email. Tiene que hacerlo antes de ser admin.",
  ADMIN_GRANT_ACCOUNT_NOT_ACTIVE: "Esa cuenta no está activa.",
  ADMIN_GRANT_CONFLICT: "El rol cambió mientras se otorgaba. Volvé a intentar.",
  ADMIN_NOT_FOUND: "Esa persona ya no es admin. Actualizá la lista.",
  ADMIN_LAST_ADMIN:
    "No se puede revocar al último admin: el panel quedaría sin administradores.",
}

export function publicError(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Ocurrió un problema. Volvé a intentar."
  if (error.code === "ADMIN_CONFLICT_OF_INTEREST")
    return "No podés modificar un registro en el que sos parte."
  // Rechazos de svc-users al gestionar admins (MOVO-292): se mapean por código, con texto
  // propio, para mostrar el motivo concreto sin reenviar el texto del servidor.
  const adminReason = ADMIN_REASONS[error.code]
  if (adminReason) return adminReason
  if (error.statusCode === 429)
    return "Demasiados intentos. Esperá antes de volver a intentar."
  if (error.statusCode >= 500)
    return "Movo no está disponible en este momento. Volvé a intentar."
  // El backend responde igual con credenciales malas, cuenta sin rol admin, email sin
  // verificar o cuenta inactiva (a propósito, para no revelar cuál). El texto las nombra
  // a todas para que el error no quede ambiguo.
  if (error.code === "AUTH_INVALID_CREDENTIALS")
    return "Los datos no son correctos, o esa cuenta no tiene acceso al panel (hace falta el rol admin y el email verificado)."
  if (error.code === "AUTH_OTP_EXPIRED")
    return "El código venció. Solicitá uno nuevo."
  if (error.code === "AUTH_OTP_INVALID")
    return "El código es incorrecto. Revisalo y volvé a intentar."
  return "No pudimos verificar los datos. Revisalos y volvé a intentar."
}
