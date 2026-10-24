import "server-only"
import { cookies } from "next/headers"
import type {
  AdminChatPage,
  AdminShipmentDetailResponse,
  AdminShipmentPage,
} from "@movo/shared/src/types/admin-shipments"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  mockEnabled,
  mockGetShipment,
  mockGetShipmentChat,
  mockListShipments,
} from "./mock"
import { gatewayQuery, type ListState } from "./params"

export const SHIPMENTS_PAGE_SIZE = 25
export const CHAT_PAGE_SIZE = 50

const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value

/** `GET /admin/shipments` (MOVO-325): página, conteos de pestañas, de estados y de avisos. */
export async function listShipments(
  state: ListState
): Promise<AdminShipmentPage> {
  const query = gatewayQuery(state, SHIPMENTS_PAGE_SIZE)
  if (mockEnabled()) return mockListShipments(query)
  return gateway<AdminShipmentPage>(`/admin/shipments?${query}`, {
    accessToken: await token(),
  })
}

/**
 * `GET /admin/shipments/:id`: la única llamada que bloquea el detalle. Eventos, fotos, pago y
 * partes vienen como bloques que pueden traer su propio error sin tumbar el resto.
 */
export async function getShipment(
  id: string
): Promise<AdminShipmentDetailResponse> {
  if (mockEnabled()) return mockGetShipment(id)
  return gateway<AdminShipmentDetailResponse>(
    `/admin/shipments/${encodeURIComponent(id)}`,
    {
      accessToken: await token(),
    }
  )
}

/** `GET /admin/shipments/:id/chat/messages`: todo el hilo, del más reciente al más antiguo. */
export async function getShipmentChat(
  id: string,
  cursor: string | null
): Promise<AdminChatPage> {
  if (mockEnabled()) return mockGetShipmentChat(id, cursor)
  const query = new URLSearchParams({ limit: String(CHAT_PAGE_SIZE) })
  if (cursor) query.set("cursor", cursor)
  return gateway<AdminChatPage>(
    `/admin/shipments/${encodeURIComponent(id)}/chat/messages?${query}`,
    { accessToken: await token() }
  )
}
