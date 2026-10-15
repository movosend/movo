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
        method: options.body === undefined ? "GET" : "POST",
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

export function publicError(error: unknown): string {
  if (!(error instanceof ApiError))
    return "Ocurrió un problema. Volvé a intentar."
  if (error.code === "ADMIN_CONFLICT_OF_INTEREST")
    return "No podés modificar un registro en el que sos parte."
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
