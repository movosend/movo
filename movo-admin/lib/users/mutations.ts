import "server-only"
import { cookies } from "next/headers"
import type {
  AdminContactUpdateBody,
  AdminContactUpdateResult,
  AdminLedgerAdjustmentBody,
  AdminLedgerAdjustmentResult,
  AdminSessionsRevokeBody,
  AdminSessionsRevokeResult,
  AdminUserNote,
  AdminUserNoteBody,
} from "@movo/shared/src/types/admin-users"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  mockAddNote,
  mockAdjustLedger,
  mockEnabled,
  mockRevokeSessions,
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
