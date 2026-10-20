import { NextRequest, NextResponse } from "next/server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  SUPPORT_STATUSES,
  type SupportListQuery,
  type SupportStatus,
} from "@movo/shared/src/types/admin-support"
import {
  getAgents,
  getContext,
  getConversation,
  getCounts,
  getEvents,
  getMessages,
  listConversations,
} from "@/lib/support/api"
import { adminForApi, noStore } from "@/lib/support/session-api"

/**
 * Lecturas de la bandeja para el navegador (el token vive en cookies httpOnly: el cliente no
 * puede llamar al gateway). Un Route Handler y no una Server Action: Next ejecuta las acciones
 * de a una y un refetch del feed bloquearía el envío de mensajes.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPAQUE = /^[A-Za-z0-9_=.-]{1,200}$/

function parseQuery(params: URLSearchParams): SupportListQuery | null {
  const status = params.get("status") as SupportStatus | null
  if (!status || !SUPPORT_STATUSES.includes(status)) return null
  const assignee = params.get("assignee") ?? undefined
  if (
    assignee &&
    assignee !== "me" &&
    assignee !== "none" &&
    !UUID.test(assignee)
  )
    return null
  const cursor = params.get("cursor") ?? undefined
  if (cursor && !OPAQUE.test(cursor)) return null
  const q = (params.get("q") ?? "").slice(0, 100)
  return { status, assignee, q: q || undefined, cursor }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> }
) {
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const { actor } = session
  const { resource } = await params
  const search = request.nextUrl.searchParams
  const bad = () =>
    NextResponse.json({ error: "invalid" }, { status: 400, headers: noStore })
  try {
    let data: unknown
    switch (resource) {
      case "list": {
        const query = parseQuery(search)
        if (!query) return bad()
        data = await listConversations(query, actor)
        break
      }
      case "counts": {
        const query = parseQuery(search)
        if (!query) return bad()
        data = await getCounts(
          { status: query.status, assignee: query.assignee, q: query.q },
          actor
        )
        break
      }
      case "conversation": {
        const id = search.get("id") ?? ""
        if (!UUID.test(id)) return bad()
        data = await getConversation(id, actor)
        break
      }
      case "messages": {
        const id = search.get("id") ?? ""
        const cursor = search.get("cursor") ?? undefined
        if (!UUID.test(id) || (cursor && !OPAQUE.test(cursor))) return bad()
        data = await getMessages(id, cursor, actor)
        break
      }
      case "context": {
        const id = search.get("id") ?? ""
        if (!UUID.test(id)) return bad()
        data = await getContext(id, actor)
        break
      }
      case "agents":
        data = await getAgents(actor)
        break
      case "events": {
        const since = search.get("since") ?? undefined
        if (since && !OPAQUE.test(since)) return bad()
        data = await getEvents(since, actor)
        break
      }
      default:
        return NextResponse.json(
          { error: "not_found" },
          { status: 404, headers: noStore }
        )
    }
    return NextResponse.json(data, { headers: noStore })
  } catch (error) {
    const status = error instanceof ApiError ? error.statusCode : 503
    const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR"
    return NextResponse.json({ error: code }, { status, headers: noStore })
  }
}
