import "server-only"
import { randomUUID } from "node:crypto"
import { headers } from "next/headers"
import {
  ApiError,
  type SerializedApiError,
} from "@movo/shared/src/errors/api-error"

export async function gateway<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE"
    body?: unknown
    accessToken?: string
    idempotencyKey?: string
  } = {}
): Promise<T> {
  const requestId = (await headers()).get("x-request-id") || randomUUID()
  let response: Response
  try {
    response = await fetch(
      `${process.env.MOVO_GATEWAY_URL ?? "https://api-dev.movosend.app"}/api/v1${path}`,
      {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        headers: {
          "Content-Type": "application/json",
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
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      }
    )
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
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

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
  if (error.code === "AUTH_OTP_EXPIRED")
    return "El código venció. Solicitá uno nuevo."
  if (error.code === "AUTH_OTP_INVALID")
    return "El código es incorrecto. Revisalo y volvé a intentar."
  return "No pudimos verificar los datos. Revisalos y volvé a intentar."
}
