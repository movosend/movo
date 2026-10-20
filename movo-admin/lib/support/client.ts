import type {
  SupportAgent,
  SupportConversation,
  SupportConversationRow,
  SupportCounts,
  SupportCountsQuery,
  SupportEventsPage,
  SupportListPage,
  SupportListQuery,
  SupportMessagesPage,
  SupportUserContext,
} from "@movo/shared/src/types/admin-support"

/** Lecturas desde el navegador, por `app/api/support/[resource]` (cookies same-origin, nunca el token). */
export class SupportFetchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code)
  }
}

async function get<T>(
  resource: string,
  params: Record<string, string | undefined>,
  signal?: AbortSignal
): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (value) query.set(key, value)
  const response = await fetch(`/api/support/${resource}?${query}`, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new SupportFetchError(response.status, body?.error ?? "INTERNAL_ERROR")
  }
  return response.json() as Promise<T>
}

const filters = (q: SupportCountsQuery) => ({
  status: q.status,
  assignee: q.assignee,
  q: q.q,
})

export const supportClient = {
  list: (q: SupportListQuery, signal?: AbortSignal) =>
    get<SupportListPage>("list", { ...filters(q), cursor: q.cursor }, signal),
  counts: (q: SupportCountsQuery, signal?: AbortSignal) =>
    get<SupportCounts>("counts", filters(q), signal),
  conversation: (id: string, signal?: AbortSignal) =>
    get<SupportConversation>("conversation", { id }, signal),
  messages: (id: string, cursor?: string, signal?: AbortSignal) =>
    get<SupportMessagesPage>("messages", { id, cursor }, signal),
  context: (id: string, signal?: AbortSignal) =>
    get<SupportUserContext>("context", { id }, signal),
  agents: (signal?: AbortSignal) => get<SupportAgent[]>("agents", {}, signal),
  events: (since: string | undefined, signal?: AbortSignal) =>
    get<SupportEventsPage>("events", { since }, signal),
}

export type { SupportConversationRow }
