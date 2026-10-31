import { DisputeReason, DisputeStatus } from "@movo/shared/src/types/dispute"

/**
 * Estado de la bandeja en la URL (mismo criterio que `lib/shipments/params.ts`): pestaña de estado
 * (abiertas por defecto), búsqueda por partes o código, motivo, ciudad del retiro, fechas de
 * apertura y la página. La página es un cursor; las anteriores viajan en `back` separadas por `.`.
 */
export interface DisputeListState {
  status: DisputeStatus
  q: string
  reason: DisputeReason | null
  city: string
  /** `YYYY-MM-DD`, días argentinos sobre la apertura. */
  from: string
  to: string
  cursor: string | null
  back: string[]
}

export const EMPTY_DISPUTE_STATE: DisputeListState = {
  status: DisputeStatus.OPEN,
  q: "",
  reason: null,
  city: "",
  from: "",
  to: "",
  cursor: null,
  back: [],
}

type Raw = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? ""
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CURSOR = /^[A-Za-z0-9_-]{1,300}$/
export const MAX_BACK = 50

function isDay(v: string): boolean {
  if (!DAY.test(v)) return false
  const date = new Date(`${v}T12:00:00Z`)
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v
}

const STATUSES: readonly string[] = Object.values(DisputeStatus)
const REASONS: readonly string[] = Object.values(DisputeReason)

export function parseDisputeState(raw: Raw): DisputeListState {
  const cursor = one(raw.cursor)
  const status = one(raw.status)
  const reason = one(raw.reason)
  return {
    status: STATUSES.includes(status)
      ? (status as DisputeStatus)
      : DisputeStatus.OPEN,
    q: one(raw.q).trim().slice(0, 100),
    reason: REASONS.includes(reason) ? (reason as DisputeReason) : null,
    city: one(raw.city).trim().slice(0, 100),
    from: isDay(one(raw.from)) ? one(raw.from) : "",
    to: isDay(one(raw.to)) ? one(raw.to) : "",
    cursor: CURSOR.test(cursor) ? cursor : null,
    back: CURSOR.test(cursor)
      ? one(raw.back)
          .split(".")
          .filter((c) => CURSOR.test(c))
          .slice(-MAX_BACK)
      : [],
  }
}

export const disputePageNumber = (state: DisputeListState): number | null =>
  state.back.length >= MAX_BACK
    ? null
    : state.back.length + (state.cursor ? 2 : 1)

/** Querystring del panel (sin `?`), sin los valores por defecto. */
export function disputeQuery(state: DisputeListState): string {
  const query = new URLSearchParams()
  if (state.status !== DisputeStatus.OPEN) query.set("status", state.status)
  if (state.q) query.set("q", state.q)
  if (state.reason) query.set("reason", state.reason)
  if (state.city) query.set("city", state.city)
  if (state.from) query.set("from", state.from)
  if (state.to) query.set("to", state.to)
  if (state.cursor) {
    query.set("cursor", state.cursor)
    if (state.back.length) query.set("back", state.back.join("."))
  }
  return query.toString()
}

export function disputeListHref(state: DisputeListState): string {
  const query = disputeQuery(state)
  return query ? `/disputes?${query}` : "/disputes"
}

export const withDisputeFilter = (
  state: DisputeListState,
  patch: Partial<DisputeListState>
): DisputeListState => ({ ...state, ...patch, cursor: null, back: [] })

export const nextDisputePage = (
  state: DisputeListState,
  cursor: string
): DisputeListState => ({
  ...state,
  cursor,
  back: state.cursor ? [...state.back, state.cursor].slice(-MAX_BACK) : [],
})

export function prevDisputePage(state: DisputeListState): DisputeListState {
  const back = state.back.slice(0, -1)
  return { ...state, cursor: state.back.at(-1) ?? null, back }
}

const dayStart = (day: string) => `${day}T00:00:00.000-03:00`
const dayEnd = (day: string) => `${day}T23:59:59.999-03:00`

/**
 * Querystring de `GET /admin/disputes`. `sort=oldest` y `city` son la propuesta de MOVO-341
 * (`types/admin-disputes.ts`); un backend que no los conozca los ignora.
 */
export function disputeGatewayQuery(
  state: DisputeListState,
  limit: number
): URLSearchParams {
  const query = new URLSearchParams({
    limit: String(limit),
    status: state.status,
    sort: "oldest",
  })
  if (state.q) query.set("q", state.q)
  if (state.reason) query.set("reason", state.reason)
  if (state.city) query.set("city", state.city)
  if (state.from)
    query.set("from", new Date(dayStart(state.from)).toISOString())
  if (state.to) query.set("to", new Date(dayEnd(state.to)).toISOString())
  if (state.cursor) query.set("cursor", state.cursor)
  return query
}
