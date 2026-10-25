"use server"
import { revalidatePath } from "next/cache"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  ACCOUNT_SANCTION_NOTE_MAX_LENGTH,
  ACCOUNT_SANCTION_REASON_MAX_LENGTH,
  type AccountSanction,
  type AccountSanctionType,
} from "@movo/shared/src/types/account-sanctions"
import {
  ADMIN_ACTION_REASON_MAX_LENGTH,
  ADMIN_NOTE_MAX_LENGTH,
  type AdminContactField,
  type AdminContactUpdateResult,
  type AdminLedgerAdjustmentResult,
  type AdminSanctionPreview,
  type AdminSanctionWithdrawal,
  type AdminSessionsRevokeResult,
  type AdminUserNote,
  type AdminUserNotePage,
  type AdminUserSanction,
} from "@movo/shared/src/types/admin-users"
import { publicError } from "@/lib/auth/api"
import {
  assertOrigin,
  requireAdmin,
  type AdminProfile,
} from "@/lib/auth/session"
import type { ActionResult } from "@/lib/users/action-result"
import { normalizeContact } from "@/lib/users/contact"
import { actionFailure } from "@/lib/users/errors"
import { loadSection, type Loaded } from "@/lib/users/load"
import {
  addUserNote,
  adjustUserLedger,
  applyUserSanction,
  getSanctionPreview,
  liftUserSanction,
  retryUserSanctionWithdrawal,
  revokeUserSessions,
  updateUserContact,
} from "@/lib/users/mutations"

/**
 * Acciones de soporte de la ficha (MOVO-294). Cada una valida origen, sesión de admin y datos
 * antes de llamar a `svc-admin`, y devuelve el error como dato para mostrarlo dentro del diálogo.
 * Todas refrescan la ficha al terminar bien.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELDS: readonly string[] = ["email", "phone"]
const CURSOR = /^[A-Za-z0-9_=.-]{1,200}$/
const NOTES_PAGE_SIZE = 20
/** Tope de cordura del panel; el que manda es `ADMIN_LEDGER_ADJUSTMENT_MAX_ARS` de `svc-payments`. */
const MAX_AMOUNT_ARS = 10_000_000

const invalid = (
  error = "Revisá los datos e intentá de nuevo."
): ActionResult<never> => ({
  ok: false,
  error,
  status: 400,
})

async function admin(
  userId: string
): Promise<AdminProfile | ActionResult<never>> {
  await assertOrigin()
  if (!UUID.test(userId)) return invalid()
  try {
    return await requireAdmin(true)
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: publicError(error), status: error.statusCode }
    throw error
  }
}

const isDenied = (
  v: AdminProfile | ActionResult<never>
): v is ActionResult<never> => "ok" in v

const cleanReason = (raw: unknown): string | null => {
  const reason = String(raw ?? "").trim()
  return reason.length >= 1 && reason.length <= ADMIN_ACTION_REASON_MAX_LENGTH
    ? reason
    : null
}

async function run<T>(
  userId: string,
  call: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const data = await call()
    revalidatePath(`/users/${userId}`)
    return { ok: true, data }
  } catch (error) {
    // Un 5xx puede haber aplicado la acción: se refresca igual para que la bitácora muestre "Sin confirmar".
    if (error instanceof ApiError && error.statusCode >= 500)
      revalidatePath(`/users/${userId}`)
    return actionFailure(error)
  }
}

export async function revokeSessions(
  userId: string,
  reason: string
): Promise<ActionResult<AdminSessionsRevokeResult>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  const clean = cleanReason(reason)
  if (!clean) return invalid("Escribí el motivo.")
  return run(userId, () =>
    revokeUserSessions(
      userId,
      { reason: clean },
      { adminId: actor.id, adminName: actor.fullName }
    )
  )
}

export async function updateContact(
  userId: string,
  input: {
    field: AdminContactField
    newValue: string
    expectedCurrent: string
    reason: string
  }
): Promise<ActionResult<AdminContactUpdateResult>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  if (!FIELDS.includes(input?.field)) return invalid()
  const reason = cleanReason(input.reason)
  if (!reason) return invalid("Escribí el motivo.")
  const newValue = normalizeContact(input.field, String(input.newValue ?? ""))
  if (!newValue)
    return invalid(
      input.field === "email"
        ? "Ingresá un email válido."
        : "Ingresá un teléfono argentino válido."
    )
  const expectedCurrent = String(input.expectedCurrent ?? "")
  if (!expectedCurrent || expectedCurrent.length > 254) return invalid()
  return run(userId, () =>
    updateUserContact(
      userId,
      { field: input.field, newValue, expectedCurrent, reason },
      { adminId: actor.id, adminName: actor.fullName }
    )
  )
}

export async function adjustLedger(
  userId: string,
  input: { amountArs: number; reason: string; idempotencyKey: string }
): Promise<ActionResult<AdminLedgerAdjustmentResult>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  const reason = cleanReason(input?.reason)
  if (!reason) return invalid("Escribí el motivo.")
  const amountArs = Number(input?.amountArs)
  if (
    !Number.isFinite(amountArs) ||
    amountArs === 0 ||
    Math.abs(amountArs) > MAX_AMOUNT_ARS ||
    Math.abs(Math.round(amountArs * 100) - amountArs * 100) > 1e-6
  )
    return invalid(
      "Ingresá un monto distinto de cero, con hasta dos decimales."
    )
  if (!UUID.test(String(input?.idempotencyKey ?? ""))) return invalid()
  return run(userId, () =>
    adjustUserLedger(
      userId,
      { amountArs, reason, idempotencyKey: input.idempotencyKey },
      { adminId: actor.id, adminName: actor.fullName }
    )
  )
}

export async function addNote(
  userId: string,
  body: string
): Promise<ActionResult<AdminUserNote>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  const text = String(body ?? "").trim()
  if (text.length < 1 || text.length > ADMIN_NOTE_MAX_LENGTH)
    return invalid(`La nota va de 1 a ${ADMIN_NOTE_MAX_LENGTH} caracteres.`)
  return run(userId, () =>
    addUserNote(
      userId,
      { body: text },
      { adminId: actor.id, adminName: actor.fullName }
    )
  )
}

/** "Ver más" de las notas: la página siguiente a `cursor`, que viene de la respuesta anterior. */
export async function loadNotesMore(
  userId: string,
  cursor: string
): Promise<Loaded<AdminUserNotePage>> {
  const actor = await admin(userId)
  if (isDenied(actor))
    return { ok: false, status: actor.ok ? 400 : (actor.status ?? 400) }
  if (!CURSOR.test(cursor)) return { ok: false, status: 400 }
  return loadSection(userId, "notes", { cursor, limit: NOTES_PAGE_SIZE })
}

// ---- MOVO-299: sanciones ----

const DATE = /^\d{4}-\d{2}-\d{2}$/
const SANCTION_TYPES: readonly string[] = ["suspension", "disable"]

const cleanSanctionReason = (raw: unknown): string | null => {
  const reason = String(raw ?? "").trim()
  return reason.length >= 1 &&
    reason.length <= ACCOUNT_SANCTION_REASON_MAX_LENGTH
    ? reason
    : null
}

/** Qué retiraría la sanción hoy, para el texto previo a confirmar (AC6). */
export async function loadSanctionPreview(
  userId: string
): Promise<ActionResult<AdminSanctionPreview>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  try {
    return { ok: true, data: await getSanctionPreview(userId) }
  } catch (error) {
    return actionFailure(error)
  }
}

/**
 * Suspender o inhabilitar. `endsOn` es el último día de la suspensión (`YYYY-MM-DD`, hora de
 * Argentina): la sanción termina al final de ese día. Sin `endsOn`, indefinida.
 */
export async function applySanction(
  userId: string,
  input: {
    type: AccountSanctionType
    reason: string
    internalNote?: string
    endsOn?: string | null
  }
): Promise<ActionResult<AdminUserSanction>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  if (!SANCTION_TYPES.includes(input?.type)) return invalid()
  const reason = cleanSanctionReason(input.reason)
  if (!reason) return invalid("Escribí el motivo que va a ver la persona.")
  const note = String(input.internalNote ?? "").trim()
  if (note.length > ACCOUNT_SANCTION_NOTE_MAX_LENGTH)
    return invalid(
      `La nota interna va hasta ${ACCOUNT_SANCTION_NOTE_MAX_LENGTH} caracteres.`
    )
  let endsAt: string | undefined
  if (input.endsOn) {
    if (input.type !== "suspension" || !DATE.test(input.endsOn))
      return invalid()
    const end = new Date(`${input.endsOn}T23:59:59-03:00`)
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now())
      return invalid("La fecha de fin tiene que ser futura.")
    endsAt = end.toISOString()
  }
  return run(userId, () =>
    applyUserSanction(
      userId,
      {
        type: input.type,
        reason,
        ...(note ? { internalNote: note } : {}),
        ...(endsAt ? { endsAt } : {}),
      },
      { adminId: actor.id, adminName: actor.fullName }
    )
  )
}

export async function liftSanction(
  userId: string,
  sanctionId: string,
  reason: string
): Promise<ActionResult<AccountSanction>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  if (!UUID.test(sanctionId)) return invalid()
  const clean = cleanSanctionReason(reason)
  if (!clean) return invalid("Escribí el motivo.")
  return run(userId, () =>
    liftUserSanction(userId, sanctionId, clean, {
      adminId: actor.id,
      adminName: actor.fullName,
    })
  )
}

export async function retrySanctionWithdrawal(
  userId: string,
  sanctionId: string
): Promise<ActionResult<AdminSanctionWithdrawal>> {
  const actor = await admin(userId)
  if (isDenied(actor)) return actor
  if (!UUID.test(sanctionId)) return invalid()
  return run(userId, () =>
    retryUserSanctionWithdrawal(userId, sanctionId, {
      adminId: actor.id,
      adminName: actor.fullName,
    })
  )
}
