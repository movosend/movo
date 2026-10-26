"use server"
import { revalidatePath } from "next/cache"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  DISPUTE_NOTE_MAX_LENGTH,
  DISPUTE_NOTE_MIN_LENGTH,
  DISPUTE_OUTCOMES,
  DISPUTE_PARTIAL_PRESETS,
  DISPUTE_REASONING_MAX_LENGTH,
  DISPUTE_REASONING_MIN_LENGTH,
  type DisputeOutcome,
  type ResolveDisputeRequest,
  type ResolveDisputeResponse,
} from "@movo/shared/src/types/dispute"
import type {
  AdminDisputeNote,
  AdminDisputeNotePage,
} from "@movo/shared/src/types/admin-disputes"
import { publicError } from "@/lib/auth/api"
import { assertOrigin, requireAdmin } from "@/lib/auth/session"
import {
  addDisputeNote,
  getDisputeNotes,
  resolveDispute,
} from "@/lib/disputes/api"
import { disputeFailure, type DisputeResult } from "@/lib/disputes/errors"

/**
 * Acciones del expediente (MOVO-343 notas, MOVO-338 resolución). Cada una valida origen, sesión de
 * admin y datos antes de llamar a `svc-admin`, que además aplica el conflicto de interés y la bitácora.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR = /^[A-Za-z0-9_=.-]{1,200}$/

const invalid = (
  error = "Revisá los datos e intentá de nuevo."
): DisputeResult<never> => ({
  ok: false,
  error,
  status: 400,
})

async function guard(disputeId: string): Promise<DisputeResult<never> | null> {
  await assertOrigin()
  if (!UUID.test(disputeId)) return invalid()
  try {
    await requireAdmin(true)
    return null
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: publicError(error), status: error.statusCode }
    throw error
  }
}

export async function addNote(
  disputeId: string,
  body: string
): Promise<DisputeResult<AdminDisputeNote>> {
  const denied = await guard(disputeId)
  if (denied) return denied
  const text = String(body ?? "").trim()
  if (
    text.length < DISPUTE_NOTE_MIN_LENGTH ||
    text.length > DISPUTE_NOTE_MAX_LENGTH
  )
    return invalid(
      `La nota tiene que tener entre ${DISPUTE_NOTE_MIN_LENGTH} y ${DISPUTE_NOTE_MAX_LENGTH} caracteres.`
    )
  try {
    const note = await addDisputeNote(disputeId, text)
    revalidatePath(`/disputes/${disputeId}`)
    return { ok: true, data: note }
  } catch (error) {
    return disputeFailure(error)
  }
}

export async function loadMoreNotes(
  disputeId: string,
  cursor: string
): Promise<DisputeResult<AdminDisputeNotePage>> {
  const denied = await guard(disputeId)
  if (denied) return denied
  if (!CURSOR.test(cursor)) return invalid()
  try {
    return { ok: true, data: await getDisputeNotes(disputeId, cursor) }
  } catch (error) {
    return disputeFailure(error)
  }
}

export interface ResolveInput {
  outcome: DisputeOutcome
  reasoning: string
  /** Solo `partial`: uno de `DISPUTE_PARTIAL_PRESETS`. Excluyente con `amountArs`. */
  percentage?: number
  /** Solo `partial`: lo que conserva el transportista. Excluyente con `percentage`. */
  amountArs?: number
}

/**
 * Resuelve la disputa o reintenta con los mismos datos (el servicio es idempotente: una disputa en
 * «Procesando pago» no mueve plata dos veces). El 422 del mínimo vuelve con `minimumArs`.
 */
export async function resolve(
  disputeId: string,
  input: ResolveInput
): Promise<DisputeResult<ResolveDisputeResponse>> {
  const denied = await guard(disputeId)
  if (denied) return denied
  const reasoning = String(input?.reasoning ?? "").trim()
  if (
    reasoning.length < DISPUTE_REASONING_MIN_LENGTH ||
    reasoning.length > DISPUTE_REASONING_MAX_LENGTH
  )
    return invalid(
      `El razonamiento tiene que tener entre ${DISPUTE_REASONING_MIN_LENGTH} y ${DISPUTE_REASONING_MAX_LENGTH} caracteres.`
    )
  if (!(DISPUTE_OUTCOMES as readonly string[]).includes(input.outcome))
    return invalid()
  const request: ResolveDisputeRequest = { outcome: input.outcome, reasoning }
  if (input.outcome === "partial") {
    const hasPercentage = input.percentage !== undefined
    const hasAmount = input.amountArs !== undefined
    if (hasPercentage === hasAmount) return invalid()
    if (hasPercentage) {
      if (!DISPUTE_PARTIAL_PRESETS.includes(Number(input.percentage)))
        return invalid()
      request.percentage = Number(input.percentage)
    } else {
      const amount = Number(input.amountArs)
      if (!Number.isFinite(amount) || amount <= 0) return invalid()
      request.amountArs = Math.round(amount * 100) / 100
    }
  } else if (input.percentage !== undefined || input.amountArs !== undefined) {
    return invalid()
  }
  try {
    const result = await resolveDispute(disputeId, request)
    revalidatePath(`/disputes/${disputeId}`)
    revalidatePath("/disputes")
    return { ok: true, data: result }
  } catch (error) {
    // Una caída del pago deja la disputa en «Procesando pago»: el expediente se redibuja con ese estado.
    if (error instanceof ApiError && error.code === "DISPUTE_PAYMENT_FAILED")
      revalidatePath(`/disputes/${disputeId}`)
    return disputeFailure(error)
  }
}
