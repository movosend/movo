import "server-only"
import { cookies } from "next/headers"
import type {
  AdminApplySanctionBody,
  AdminContactUpdateBody,
  AdminContactUpdateResult,
  AdminLedgerAdjustmentBody,
  AdminLedgerAdjustmentResult,
  AdminSanctionPreview,
  AdminSanctionWithdrawal,
  AdminSessionsRevokeBody,
  AdminSessionsRevokeResult,
  AdminUserNote,
  AdminUserNoteBody,
  AdminUserSanction,
} from "@movo/shared/src/types/admin-users"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  mockAddNote,
  mockAdjustLedger,
  mockApplySanction,
  mockEnabled,
  mockLiftSanction,
  mockRetryWithdrawal,
  mockRevokeSessions,
  mockSanctionPreview,
  mockUpdateContact,
  type MockActor,
} from "./mock"

/**
 * Acciones de soporte sobre la cuenta (sección "Acciones" de MOVO-294). Son escrituras: en
 * `svc-admin` pasan por `runAdminAction` (conflicto de interés + bitácora). Sin reintento
 * automático: una escritura que no respondió pudo haberse aplicada.
 */
const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value
const path = (id: string, tail: string) =>
  `/admin/users/${encodeURIComponent(id)}/${tail}`

export async function revokeUserSessions(
  id: string,
  body: AdminSessionsRevokeBody,
  actor: MockActor
): Promise<AdminSessionsRevokeResult> {
  if (mockEnabled()) return mockRevokeSessions(id, body.reason, actor)
  return gateway(path(id, "sessions/revoke"), {
    body,
    accessToken: await token(),
  })
}

export async function updateUserContact(
  id: string,
  body: AdminContactUpdateBody,
  actor: MockActor
): Promise<AdminContactUpdateResult> {
  if (mockEnabled()) return mockUpdateContact(id, body, actor)
  return gateway(path(id, "contact"), { body, accessToken: await token() })
}

export async function adjustUserLedger(
  id: string,
  body: AdminLedgerAdjustmentBody,
  actor: MockActor
): Promise<AdminLedgerAdjustmentResult> {
  if (mockEnabled()) return mockAdjustLedger(id, body, actor)
  return gateway(path(id, "ledger/adjustments"), {
    body,
    accessToken: await token(),
  })
}

export async function addUserNote(
  id: string,
  body: AdminUserNoteBody,
  actor: MockActor
): Promise<AdminUserNote> {
  if (mockEnabled()) return mockAddNote(id, body.body, actor)
  return gateway(path(id, "notes"), { body, accessToken: await token() })
}

// ---- MOVO-299: sanciones ----

/** Vista previa de lo que retiraría una sanción hoy. Es una lectura: no deja bitácora. */
export async function getSanctionPreview(
  id: string
): Promise<AdminSanctionPreview> {
  if (mockEnabled()) return mockSanctionPreview(id)
  return gateway(path(id, "sanctions/preview"), { accessToken: await token() })
}

export async function applyUserSanction(
  id: string,
  body: AdminApplySanctionBody,
  actor: MockActor
): Promise<AdminUserSanction> {
  if (mockEnabled()) return mockApplySanction(id, body, actor)
  return gateway(path(id, "sanctions"), { body, accessToken: await token() })
}

export async function liftUserSanction(
  id: string,
  sanctionId: string,
  reason: string,
  actor: MockActor
): Promise<AdminUserSanction> {
  if (mockEnabled()) return mockLiftSanction(id, sanctionId, reason, actor)
  return gateway(path(id, `sanctions/${encodeURIComponent(sanctionId)}/lift`), {
    body: { reason },
    accessToken: await token(),
  })
}

/** Reintento del retiro (idempotente en `svc-shipments`). */
export async function retryUserSanctionWithdrawal(
  id: string,
  sanctionId: string,
  actor: MockActor
): Promise<AdminSanctionWithdrawal> {
  if (mockEnabled()) return mockRetryWithdrawal(id, sanctionId, actor)
  return gateway(
    path(id, `sanctions/${encodeURIComponent(sanctionId)}/withdraw`),
    { method: "POST", accessToken: await token() }
  )
}
