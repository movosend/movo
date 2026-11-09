"use server"
import { revalidatePath } from "next/cache"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  ADMIN_KYC_DECISION_REASON_MAX_LENGTH,
  ADMIN_KYC_DECISION_REASON_MIN_LENGTH,
  type AdminKycDecision,
  type AdminKycDecisionResponse,
} from "@movo/shared/src/types/admin-kyc"
import { publicError } from "@/lib/auth/api"
import { assertOrigin, requireAdmin } from "@/lib/auth/session"
import { decideKycReview } from "@/lib/kyc/api"
import { kycActionFailure } from "@/lib/kyc/errors"
import type { ActionResult } from "@/lib/users/action-result"

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/
const DECISIONS: readonly string[] = ["approved", "rejected"]

const invalid = (error: string): ActionResult<never> => ({
  ok: false,
  error,
  status: 400,
})

/**
 * Aprobar o rechazar un caso de la cola de KYC. Valida origen, sesión de admin y datos antes de llamar a `svc-admin`,
 * y devuelve el error como dato para mostrarlo dentro del diálogo. Sin clave de idempotencia: un reintento recibe 409
 * (`KYC_REVIEW_STATUS_CHANGED`) porque `svc-users` solo decide un caso que sigue en revisión.
 */
export async function decideKyc(
  sessionId: string,
  decision: AdminKycDecision,
  reason: string
): Promise<ActionResult<AdminKycDecisionResponse>> {
  await assertOrigin()
  if (!SESSION_ID.test(String(sessionId ?? "")))
    return invalid("Revisá los datos e intentá de nuevo.")
  if (!DECISIONS.includes(decision))
    return invalid("Revisá los datos e intentá de nuevo.")
  const clean = String(reason ?? "").trim()
  if (
    clean.length < ADMIN_KYC_DECISION_REASON_MIN_LENGTH ||
    clean.length > ADMIN_KYC_DECISION_REASON_MAX_LENGTH
  )
    return invalid(
      `El motivo tiene que tener entre ${ADMIN_KYC_DECISION_REASON_MIN_LENGTH} y ${ADMIN_KYC_DECISION_REASON_MAX_LENGTH} caracteres.`
    )
  try {
    await requireAdmin(true)
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: publicError(error), status: error.statusCode }
    throw error
  }
  try {
    const data = await decideKycReview(sessionId, { decision, reason: clean })
    revalidatePath("/kyc")
    revalidatePath(`/kyc/${sessionId}`)
    return { ok: true, data }
  } catch (error) {
    // Un 5xx puede haber aplicado la decisión (salvo el rechazo de Didit): se refresca igual la cola.
    if (
      error instanceof ApiError &&
      error.statusCode >= 500 &&
      error.code !== "KYC_PROVIDER_ERROR"
    ) {
      revalidatePath("/kyc")
      revalidatePath(`/kyc/${sessionId}`)
    }
    return kycActionFailure(error)
  }
}
