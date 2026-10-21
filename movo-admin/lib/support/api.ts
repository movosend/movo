import "server-only"
import { cookies } from "next/headers"
import type {
  SupportAgent,
  SupportAttachmentCreateBody,
  SupportAttachmentCreateResult,
  SupportConversation,
  SupportCounts,
  SupportCountsQuery,
  SupportEventsPage,
  SupportListPage,
  SupportListQuery,
  SupportMessage,
  SupportMessagesPage,
  SupportPatchBody,
  SupportRealtimeTicket,
  SupportSendBody,
  SupportUserContext,
} from "@movo/shared/src/types/admin-support"
import { gateway, gatewayBaseUrl } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  mockAgents,
  mockContext,
  mockCounts,
  mockCreateAttachment,
  mockEnabled,
  mockEvents,
  mockGetConversation,
  mockList,
  mockMarkRead,
  mockMessages,
  mockPatch,
  mockRealtimeTicket,
  mockSend,
  mockSetStatus,
  type MockActor,
} from "./mock"
import { isTrustedSupportSocketUrl } from "./realtime/url"

/**
 * Cliente de `svc-admin` `/admin/support/*` (MOVO-322). El panel no llama a `svc-shipments` ni a
 * las rutas de la app (decisión 6 de MOVO-286). Con `MOVO_ADMIN_MOCK=1` cada función cae al mock.
 * Las escrituras (`send`, `patch`, `resolve`, `reopen`, adjuntos) llevan el actor para el mock; el
 * backend real lo saca del token.
 */
const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value
const base = "/admin/support"
const conv = (id: string) => `${base}/conversations/${encodeURIComponent(id)}`

function qs(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value) query.set(key, value)
  return query.size ? `?${query}` : ""
}

export async function listConversations(
  query: SupportListQuery,
  actor: MockActor
): Promise<SupportListPage> {
  if (mockEnabled()) return mockList(query, actor)
  return gateway(
    `${base}/conversations${qs({ status: query.status, assignee: query.assignee, q: query.q, cursor: query.cursor })}`,
    { accessToken: await token() }
  )
}

export async function getCounts(
  query: SupportCountsQuery,
  actor: MockActor
): Promise<SupportCounts> {
  if (mockEnabled()) return mockCounts(query, actor)
  return gateway(
    `${base}/counts${qs({ status: query.status, assignee: query.assignee, q: query.q })}`,
    { accessToken: await token() }
  )
}

export async function getConversation(
  id: string,
  actor: MockActor
): Promise<SupportConversation> {
  if (mockEnabled()) return mockGetConversation(id, actor)
  return gateway(conv(id), { accessToken: await token() })
}

export async function getMessages(
  id: string,
  cursor: string | undefined,
  actor: MockActor
): Promise<SupportMessagesPage> {
  if (mockEnabled()) return mockMessages(id, cursor, actor)
  return gateway(`${conv(id)}/messages${qs({ cursor })}`, {
    accessToken: await token(),
  })
}

export async function getContext(
  id: string,
  actor: MockActor
): Promise<SupportUserContext> {
  if (mockEnabled()) return mockContext(id, actor)
  return gateway(`${conv(id)}/context`, { accessToken: await token() })
}

export async function getAgents(actor: MockActor): Promise<SupportAgent[]> {
  if (mockEnabled()) return mockAgents(actor)
  return gateway(`${base}/agents`, { accessToken: await token() })
}

export async function sendMessage(
  id: string,
  body: SupportSendBody,
  actor: MockActor
): Promise<SupportMessage> {
  if (mockEnabled()) return mockSend(id, body, actor)
  return gateway(`${conv(id)}/messages`, { body, accessToken: await token() })
}

export async function patchConversation(
  id: string,
  body: SupportPatchBody,
  actor: MockActor
): Promise<SupportConversation> {
  if (mockEnabled()) return mockPatch(id, body, actor)
  return gateway(conv(id), {
    method: "PATCH",
    body,
    accessToken: await token(),
  })
}

export async function setConversationStatus(
  id: string,
  action: "resolve" | "reopen",
  actor: MockActor
): Promise<SupportConversation> {
  if (mockEnabled()) return mockSetStatus(id, action, actor)
  return gateway(`${conv(id)}/${action}`, {
    method: "POST",
    body: {},
    accessToken: await token(),
  })
}

/** Lectura: no va a bitácora ni pasa por el conflicto de interés. */
export async function markRead(id: string, actor: MockActor): Promise<void> {
  if (mockEnabled()) return mockMarkRead(id, actor)
  await gateway(`${conv(id)}/read`, {
    method: "POST",
    body: {},
    accessToken: await token(),
  })
}

export async function createAttachment(
  body: SupportAttachmentCreateBody,
  actor: MockActor
): Promise<SupportAttachmentCreateResult> {
  if (mockEnabled()) return mockCreateAttachment(body, actor)
  return gateway(`${base}/attachments`, { body, accessToken: await token() })
}

export async function getRealtimeTicket(
  actor: MockActor
): Promise<SupportRealtimeTicket> {
  if (mockEnabled()) return mockRealtimeTicket(actor)
  const ticket = await gateway<SupportRealtimeTicket>(
    `${base}/realtime-ticket`,
    {
      method: "POST",
      body: {},
      accessToken: await token(),
    }
  )
  if (
    !isTrustedSupportSocketUrl(
      ticket.url,
      gatewayBaseUrl(),
      process.env.NODE_ENV === "development"
    )
  )
    throw new Error("Invalid support WebSocket URL")
  return ticket
}

/** Respaldo del WS: eventos posteriores a `since` (cursor opaco). */
export async function getEvents(
  since: string | undefined,
  actor: MockActor
): Promise<SupportEventsPage> {
  if (mockEnabled()) return mockEvents(since, actor)
  return gateway(`${base}/events${qs({ since })}`, {
    accessToken: await token(),
  })
}
