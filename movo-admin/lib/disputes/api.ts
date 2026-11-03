import "server-only"
import { cookies } from "next/headers"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type {
  ResolveDisputeRequest,
  ResolveDisputeResponse,
} from "@movo/shared/src/types/dispute"
import type {
  AdminDisputeHandshakeEvent,
  AdminDisputeNote,
  AdminDisputeNotePage,
  AdminDisputePage,
  AdminDisputePhotos,
  AdminDisputeResolutionPreview,
} from "@movo/shared/src/types/admin-disputes"
import type {
  AdminDisputeCounts,
  AdminDisputeDetail,
} from "@movo/shared/src/types/admin-disputes"
import type { AdminBlock } from "@movo/shared/src/types/admin-shipments"
import { gateway } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  mockAddDisputeNote,
  mockDisputeHandshake,
  mockDisputeNotes,
  mockDisputePhotos,
  mockDisputePreview,
  mockEnabled,
  mockGetDispute,
  mockListDisputes,
  mockOpenDisputeCount,
  mockResolveDispute,
} from "./mock"
import { disputeGatewayQuery, type DisputeListState } from "./params"

export const DISPUTES_PAGE_SIZE = 25

const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value
const path = (id: string, tail = "") =>
  `/admin/disputes/${encodeURIComponent(id)}${tail}`

/** `GET /admin/disputes` (MOVO-337): página, `statusCounts` y las filas con partes y motivo. */
export async function listDisputes(
  state: DisputeListState
): Promise<AdminDisputePage> {
  const query = disputeGatewayQuery(state, DISPUTES_PAGE_SIZE)
  if (mockEnabled()) return mockListDisputes(query)
  return gateway<AdminDisputePage>(`/admin/disputes?${query}`, {
    accessToken: await token(),
  })
}

/** `GET /admin/disputes/:id`: lo único que bloquea el expediente; el resto son bloques aparte. */
export async function getDispute(id: string): Promise<AdminDisputeDetail> {
  if (mockEnabled()) return mockGetDispute(id)
  return gateway<AdminDisputeDetail>(path(id), {
    accessToken: await token(),
  })
}

export async function getDisputePhotos(
  id: string
): Promise<AdminDisputePhotos> {
  if (mockEnabled()) return mockDisputePhotos(id)
  return gateway(path(id, "/photos"), { accessToken: await token() })
}

export async function getDisputeHandshake(
  id: string
): Promise<AdminDisputeHandshakeEvent[]> {
  if (mockEnabled()) return mockDisputeHandshake(id)
  return gateway(path(id, "/handshake"), { accessToken: await token() })
}

export async function getDisputeNotes(
  id: string,
  cursor: string | null = null
): Promise<AdminDisputeNotePage> {
  if (mockEnabled()) return mockDisputeNotes(id, cursor)
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : ""
  return gateway(path(id, `/notes${query}`), { accessToken: await token() })
}

export async function getResolutionPreview(
  id: string
): Promise<AdminDisputeResolutionPreview> {
  if (mockEnabled()) return mockDisputePreview(id)
  return gateway(path(id, "/resolution-preview"), {
    accessToken: await token(),
  })
}

/** `POST /admin/disputes/:id/notes`: nota interna, nunca visible para las partes. */
export async function addDisputeNote(
  id: string,
  body: string
): Promise<AdminDisputeNote> {
  if (mockEnabled()) return mockAddDisputeNote(id, body)
  return gateway(path(id, "/notes"), {
    body: { body },
    accessToken: await token(),
  })
}

/**
 * `POST /admin/disputes/:id/resolve`. Idempotente en el servicio: reintentar con los mismos datos
 * no mueve plata dos veces (`replayed`). Con datos distintos es 409 `DISPUTE_RESOLUTION_MISMATCH`.
 */
export async function resolveDispute(
  id: string,
  request: ResolveDisputeRequest
): Promise<ResolveDisputeResponse> {
  if (mockEnabled()) return mockResolveDispute(id, request)
  return gateway(path(id, "/resolve"), {
    body: request,
    accessToken: await token(),
  })
}

/** Abiertas para el menú lateral (`GET /admin/disputes/counts`, MOVO-341); `null` si no se pudo y el menú no muestra número. */
export async function openDisputeCount(): Promise<number | null> {
  try {
    if (mockEnabled()) return await mockOpenDisputeCount()
    const counts = await gateway<AdminDisputeCounts>("/admin/disputes/counts", {
      accessToken: await token(),
    })
    return counts.open
  } catch {
    return null
  }
}

/** Un bloque del expediente: o trae el dato, o la causa, sin tumbar al resto. */
export async function asBlock<T>(
  load: () => Promise<T>
): Promise<AdminBlock<T>> {
  try {
    return { data: await load(), error: null }
  } catch (error) {
    if (error instanceof ApiError)
      return { data: null, error: { code: error.code, message: error.message } }
    return {
      data: null,
      error: {
        code: "BLOCK_UNAVAILABLE",
        message: "No se pudo obtener este bloque.",
      },
    }
  }
}
