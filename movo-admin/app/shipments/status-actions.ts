"use server"
import { revalidatePath } from "next/cache"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  FORCE_STATUS_REASON_MAX_LENGTH,
  FORCE_STATUS_REASON_MIN_LENGTH,
  type ChangeShipmentStatusResponse,
  type ShipmentStatusOptions,
  type StepUpChallenge,
} from "@movo/shared/src/types/admin-shipments"
import { publicError } from "@/lib/auth/api"
import { assertOrigin, requireAdmin } from "@/lib/auth/session"
import {
  changeStatus,
  getStatusOptions,
  requestStepUp,
  verifyStepUp,
} from "@/lib/shipments/status-change"
import { statusFailure } from "@/lib/shipments/status-errors"
import type { StatusResult } from "@/lib/shipments/status-result"
import { isShipmentStatus as isStatus } from "@/lib/shipments/format"

/**
 * Acciones del modal de cambio de estado (MOVO-333). Cada una valida origen, sesión de admin y datos antes de
 * llamar a `svc-admin`, y devuelve el error como dato para mostrarlo dentro del modal. Las reglas finales
 * (matriz, conflicto de interés, hold, segundo factor) las decide el backend: esto solo evita llamadas inútiles.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIX_DIGITS = /^\d{6}$/
const OPAQUE = /^[A-Za-z0-9_=.-]{1,300}$/

const invalid = (
  error = "Revisá los datos e intentá de nuevo."
): StatusResult<never> => ({
  ok: false,
  error,
  status: 400,
})

async function guard(shipmentId: string): Promise<StatusResult<never> | null> {
  await assertOrigin()
  if (!UUID.test(shipmentId)) return invalid()
  try {
    await requireAdmin(true)
    return null
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: publicError(error), status: error.statusCode }
    throw error
  }
}

/** Las opciones desde el estado actual del envío: qué se puede, con qué riesgo y qué se exige. */
export async function loadStatusOptions(
  shipmentId: string
): Promise<StatusResult<ShipmentStatusOptions>> {
  const denied = await guard(shipmentId)
  if (denied) return denied
  try {
    return { ok: true, data: await getStatusOptions(shipmentId) }
  } catch (error) {
    return statusFailure(error)
  }
}

/** "Enviar código": el segundo factor se pide para UNA acción (este envío y este destino). */
export async function sendStepUpCode(
  shipmentId: string,
  targetStatus: string
): Promise<StatusResult<StepUpChallenge>> {
  const denied = await guard(shipmentId)
  if (denied) return denied
  if (!isStatus(targetStatus)) return invalid()
  try {
    return {
      ok: true,
      data: await requestStepUp({ shipmentId, targetStatus }),
    }
  } catch (error) {
    return statusFailure(error)
  }
}

export interface SubmitStatusChangeInput {
  targetStatus: string
  expectedStatus: string
  reason: string
  typedCode?: string
  idempotencyKey: string
  /** DD-055: asignar sin hold real (solo destino `assigned`). */
  simulatePayment?: boolean
  /** El código de 6 dígitos que llegó por email; se canjea por el token en el mismo paso. */
  otp?: { challengeId: string; code: string }
  /** Un token ya verificado (de un intento anterior que no lo gastó). */
  stepUpToken?: string
}

/**
 * Confirma el cambio. Si trae el código lo verifica primero; si el cambio es rechazado por una razón de negocio y
 * el token sigue vigente, lo devuelve para reintentar sin pedir otro código.
 */
export async function submitStatusChange(
  shipmentId: string,
  input: SubmitStatusChangeInput
): Promise<StatusResult<ChangeShipmentStatusResponse>> {
  const denied = await guard(shipmentId)
  if (denied) return denied
  if (!isStatus(input?.targetStatus) || !isStatus(input?.expectedStatus))
    return invalid()
  const reason = String(input.reason ?? "").trim()
  if (
    reason.length < FORCE_STATUS_REASON_MIN_LENGTH ||
    reason.length > FORCE_STATUS_REASON_MAX_LENGTH
  )
    return invalid(
      `El motivo tiene que tener entre ${FORCE_STATUS_REASON_MIN_LENGTH} y ${FORCE_STATUS_REASON_MAX_LENGTH} caracteres.`
    )
  const idempotencyKey = String(input.idempotencyKey ?? "")
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return invalid()
  const typedCode =
    input.typedCode === undefined
      ? undefined
      : String(input.typedCode).slice(0, 32)
  if (input.simulatePayment !== undefined && input.simulatePayment !== true)
    return invalid()
  if (input.simulatePayment && input.targetStatus !== "assigned")
    return invalid("El pago simulado solo aplica al pasar a Asignado.")
  if (input.otp && !SIX_DIGITS.test(String(input.otp.code ?? "")))
    return invalid("El código tiene 6 dígitos.")
  if (input.otp && !OPAQUE.test(String(input.otp.challengeId ?? "")))
    return invalid()
  if (input.stepUpToken !== undefined && !OPAQUE.test(input.stepUpToken))
    return invalid()

  let stepUpToken = input.stepUpToken
  if (input.otp) {
    try {
      stepUpToken = (
        await verifyStepUp({
          shipmentId,
          targetStatus: input.targetStatus,
          challengeId: input.otp.challengeId,
          code: input.otp.code,
        })
      ).stepUpToken
    } catch (error) {
      // Verificar el código no aplica nada: un 5xx acá no es "pudo haberse aplicado el cambio".
      const failure = statusFailure(error)
      return failure.unconfirmed
        ? {
            ok: false,
            error:
              "No pudimos verificar el código. Reintentá en unos momentos.",
            code: failure.code,
            status: failure.status,
          }
        : failure
    }
  }

  try {
    const data = await changeStatus(shipmentId, {
      targetStatus: input.targetStatus,
      expectedStatus: input.expectedStatus,
      reason,
      ...(typedCode ? { typedCode } : {}),
      ...(stepUpToken ? { stepUpToken } : {}),
      ...(input.simulatePayment ? { simulatePayment: true } : {}),
      idempotencyKey,
    })
    revalidatePath(`/shipments/${shipmentId}`)
    return { ok: true, data }
  } catch (error) {
    // Un 5xx puede haber aplicado el cambio: se refresca igual para que la línea de tiempo lo muestre.
    if (error instanceof ApiError && error.statusCode >= 500)
      revalidatePath(`/shipments/${shipmentId}`)
    // El token solo se devuelve si el backend no lo gastó: un rechazo de negocio lo deja vivo; en un 5xx pudo
    // gastarse y un código inválido ya no sirve.
    const alive =
      stepUpToken &&
      error instanceof ApiError &&
      error.statusCode < 500 &&
      error.code !== "STEP_UP_INVALID" &&
      error.code !== "STEP_UP_REQUIRED"
    return statusFailure(error, alive ? { stepUpToken } : {})
  }
}
