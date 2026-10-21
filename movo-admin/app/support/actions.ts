"use server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MAX_PER_MESSAGE,
  SUPPORT_ATTACHMENT_TYPES,
  SUPPORT_MESSAGE_MAX_LENGTH,
  SUPPORT_PRIORITIES,
  SUPPORT_TAGS,
  SUPPORT_TOPICS,
  type SupportAttachmentCreateResult,
  type SupportConversation,
  type SupportMessage,
  type SupportPatchBody,
  type SupportRealtimeTicket,
} from "@movo/shared/src/types/admin-support"
import { publicError } from "@/lib/auth/api"
import {
  assertOrigin,
  requireAdmin,
  type AdminProfile,
} from "@/lib/auth/session"
import {
  createAttachment,
  getRealtimeTicket,
  markRead as markReadApi,
  patchConversation,
  sendMessage as sendMessageApi,
  setConversationStatus,
} from "@/lib/support/api"
import {
  supportFailure,
  type SupportFailure,
  type SupportResult,
} from "@/lib/support/errors"

/**
 * Escrituras de la bandeja (MOVO-322): cada una valida origen, sesión de admin y forma de los datos
 * antes de llamar a `svc-admin`, y devuelve el error como dato para mostrarlo en el compositor o
 * en el menú. Sin reintento automático: una escritura que no respondió pudo haberse aplicado. Las
 * lecturas van por `app/api/support/[resource]` (Route Handler), no por acá.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const invalid = (
  error = "Revisá los datos e intentá de nuevo."
): SupportFailure => ({
  ok: false,
  error,
  status: 400,
})

async function admin(id?: string): Promise<AdminProfile | SupportFailure> {
  await assertOrigin()
  if (id !== undefined && !UUID.test(id)) return invalid()
  try {
    return await requireAdmin(true)
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, error: publicError(error), status: error.statusCode }
    throw error
  }
}
const isDenied = (v: AdminProfile | SupportFailure): v is SupportFailure =>
  "ok" in v
const actorOf = (a: AdminProfile) => ({ adminId: a.id, adminName: a.fullName })

async function run<T>(call: () => Promise<T>): Promise<SupportResult<T>> {
  try {
    return { ok: true, data: await call() }
  } catch (error) {
    return supportFailure(error)
  }
}

export async function sendSupportMessage(
  conversationId: string,
  input: {
    body: string
    clientMessageId: string
    internal: boolean
    attachmentIds: string[]
  }
): Promise<SupportResult<SupportMessage>> {
  const actor = await admin(conversationId)
  if (isDenied(actor)) return actor
  const body = String(input?.body ?? "").trim()
  const ids = Array.isArray(input?.attachmentIds) ? input.attachmentIds : []
  if (
    !UUID.test(String(input?.clientMessageId)) ||
    (!body && ids.length === 0) ||
    body.length > SUPPORT_MESSAGE_MAX_LENGTH ||
    ids.length > SUPPORT_ATTACHMENT_MAX_PER_MESSAGE ||
    !ids.every((id) => UUID.test(id))
  )
    return invalid()
  return run(() =>
    sendMessageApi(
      conversationId,
      {
        body,
        clientMessageId: input.clientMessageId,
        internal: input.internal === true ? true : undefined,
        attachmentIds: ids.length ? ids : undefined,
      },
      actorOf(actor)
    )
  )
}

export async function patchSupportConversation(
  conversationId: string,
  input: SupportPatchBody
): Promise<SupportResult<SupportConversation>> {
  const actor = await admin(conversationId)
  if (isDenied(actor)) return actor
  const body: SupportPatchBody = {}
  if (input?.assignedTo !== undefined) {
    if (input.assignedTo !== null && !UUID.test(input.assignedTo))
      return invalid()
    body.assignedTo = input.assignedTo
  }
  if (input?.priority !== undefined) {
    if (!SUPPORT_PRIORITIES.includes(input.priority)) return invalid()
    body.priority = input.priority
  }
  if (input?.topic !== undefined) {
    if (!SUPPORT_TOPICS.includes(input.topic)) return invalid()
    body.topic = input.topic
  }
  if (input?.tags !== undefined) {
    if (
      !Array.isArray(input.tags) ||
      !input.tags.every((t) => (SUPPORT_TAGS as readonly string[]).includes(t))
    )
      return invalid()
    body.tags = input.tags
  }
  if (input?.shipmentId !== undefined) {
    if (input.shipmentId !== null && !UUID.test(input.shipmentId))
      return invalid()
    body.shipmentId = input.shipmentId
  }
  if (Object.keys(body).length === 0) return invalid()
  return run(() => patchConversation(conversationId, body, actorOf(actor)))
}

export async function setSupportStatus(
  conversationId: string,
  action: "resolve" | "reopen"
): Promise<SupportResult<SupportConversation>> {
  const actor = await admin(conversationId)
  if (isDenied(actor)) return actor
  if (action !== "resolve" && action !== "reopen") return invalid()
  return run(() =>
    setConversationStatus(conversationId, action, actorOf(actor))
  )
}

/** Lectura (abrir la conversación): no entra en bitácora, pero necesita sesión y origen. */
export async function markSupportRead(
  conversationId: string
): Promise<SupportResult<null>> {
  const actor = await admin(conversationId)
  if (isDenied(actor)) return actor
  return run(async () => {
    await markReadApi(conversationId, actorOf(actor))
    return null
  })
}

export async function createSupportAttachment(
  conversationId: string,
  input: { contentType: string; sizeBytes: number }
): Promise<SupportResult<SupportAttachmentCreateResult>> {
  const actor = await admin(conversationId)
  if (isDenied(actor)) return actor
  const type = SUPPORT_ATTACHMENT_TYPES.find((t) => t === input?.contentType)
  if (
    !type ||
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES
  )
    return invalid("Solo se admiten imágenes JPG, PNG o WebP de hasta 5 MB.")
  return run(() =>
    createAttachment(
      { contentType: type, sizeBytes: input.sizeBytes, conversationId },
      actorOf(actor)
    )
  )
}

/** Ticket de un solo uso para abrir el WS sin pasar el token por el JS (ver `lib/support/realtime`). */
export async function requestRealtimeTicket(): Promise<
  SupportResult<SupportRealtimeTicket>
> {
  const actor = await admin()
  if (isDenied(actor)) return actor
  return run(() => getRealtimeTicket(actorOf(actor)))
}
