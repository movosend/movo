import {
  ADMIN_SHIPMENT_GROUP_STATUSES,
  ADMIN_SHIPMENT_GROUPS,
  type AdminShipmentGroup,
} from "@movo/shared/src/types/admin-shipments"
import type { ShipmentStatusValue, ShipmentTab } from "./format"

/**
 * Estado del listado en la URL (AC6: volver del detalle deja el filtro y la página): pestaña,
 * estado, búsqueda, ciudad, fechas, "con alerta" y la página. La página es un cursor; las
 * anteriores viajan en `back` separadas por `.` (que no aparece en un cursor base64url), así
 * "Anterior" no necesita pedirle nada al servidor.
 */
export interface ListState {
  tab: ShipmentTab
  status: ShipmentStatusValue | null
  q: string
  city: string
  /** `YYYY-MM-DD`, días argentinos sobre el último cambio de estado. */
  from: string
  to: string
  alert: boolean
  cursor: string | null
  back: string[]
}

export const EMPTY_LIST_STATE: ListState = {
  tab: "all",
  status: null,
  q: "",
  city: "",
  from: "",
  to: "",
  alert: false,
  cursor: null,
  back: [],
}

type Raw = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? ""
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CURSOR = /^[A-Za-z0-9_-]{1,300}$/

const isGroup = (v: string): v is AdminShipmentGroup =>
  (ADMIN_SHIPMENT_GROUPS as readonly string[]).includes(v)

export function parseListState(raw: Raw): ListState {
  const tab = isGroup(one(raw.group))
    ? (one(raw.group) as AdminShipmentGroup)
    : "all"
  const statuses: readonly string[] =
    tab === "all" ? [] : ADMIN_SHIPMENT_GROUP_STATUSES[tab]
  const status = one(raw.status)
  const cursor = one(raw.cursor)
  return {
    tab,
    // Un estado solo vale dentro de su pestaña: es un chip de esa pestaña.
    status: statuses.includes(status) ? (status as ShipmentStatusValue) : null,
    q: one(raw.q).trim().slice(0, 100),
    city: one(raw.city).trim().slice(0, 100),
    from: DAY.test(one(raw.from)) ? one(raw.from) : "",
    to: DAY.test(one(raw.to)) ? one(raw.to) : "",
    alert: one(raw.alert) === "1",
    cursor: CURSOR.test(cursor) ? cursor : null,
    back: CURSOR.test(cursor)
      ? one(raw.back)
          .split(".")
          .filter((c) => CURSOR.test(c))
          .slice(-20)
      : [],
  }
}

/** Querystring del panel (sin `?`), sin los valores por defecto. */
export function listQuery(state: ListState): string {
  const query = new URLSearchParams()
  if (state.tab !== "all") query.set("group", state.tab)
  if (state.status) query.set("status", state.status)
  if (state.q) query.set("q", state.q)
  if (state.city) query.set("city", state.city)
  if (state.from) query.set("from", state.from)
  if (state.to) query.set("to", state.to)
  if (state.alert) query.set("alert", "1")
  if (state.cursor) {
    query.set("cursor", state.cursor)
    if (state.back.length) query.set("back", state.back.join("."))
  }
  return query.toString()
}

export function listHref(state: ListState): string {
  const query = listQuery(state)
  return query ? `/shipments?${query}` : "/shipments"
}

/** Cambiar cualquier filtro vuelve a la primera página. */
export const withFilter = (
  state: ListState,
  patch: Partial<ListState>
): ListState => ({
  ...state,
  ...patch,
  cursor: null,
  back: [],
})

export const nextPage = (state: ListState, cursor: string): ListState => ({
  ...state,
  cursor,
  back: state.cursor ? [...state.back, state.cursor] : [],
})

export function prevPage(state: ListState): ListState {
  const back = state.back.slice(0, -1)
  return { ...state, cursor: state.back.at(-1) ?? null, back }
}

/** Medianoche argentina (UTC−3, sin horario de verano) del día, en ISO. */
const dayStart = (day: string) => `${day}T00:00:00.000-03:00`
const dayEnd = (day: string) => `${day}T23:59:59.999-03:00`

/** Querystring de `GET /admin/shipments` (MOVO-325). */
export function gatewayQuery(state: ListState, limit: number): URLSearchParams {
  const query = new URLSearchParams({ limit: String(limit) })
  if (state.tab !== "all") query.set("group", state.tab)
  if (state.status) query.set("status", state.status)
  if (state.q) query.set("q", state.q)
  if (state.city) query.set("city", state.city)
  if (state.from)
    query.set("from", new Date(dayStart(state.from)).toISOString())
  if (state.to) query.set("to", new Date(dayEnd(state.to)).toISOString())
  if (state.alert) query.set("alert", "true")
  if (state.cursor) query.set("cursor", state.cursor)
  return query
}
