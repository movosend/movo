"use server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type { AdminChatPage } from "@movo/shared/src/types/admin-shipments"
import { assertOrigin, requireAdmin } from "@/lib/auth/session"
import { getShipmentChat } from "@/lib/shipments/api"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ChatPageResult =
  { ok: true; page: AdminChatPage } | { ok: false; status: number }

/** "Ver mensajes anteriores" del chat del envío: solo lectura, el error vuelve como dato. */
export async function loadChatPage(
  shipmentId: string,
  cursor: string
): Promise<ChatPageResult> {
  await assertOrigin()
  if (!UUID.test(shipmentId) || !cursor || cursor.length > 300)
    return { ok: false, status: 400 }
  try {
    await requireAdmin(true)
    return { ok: true, page: await getShipmentChat(shipmentId, cursor) }
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, status: error.statusCode }
    throw error
  }
}
