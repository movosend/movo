import "server-only"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  ACTIVE_SHIPMENT_STATUSES,
  ADMIN_SHIPMENT_GROUP_STATUSES,
  ADMIN_SHIPMENT_GROUPS,
  isAdminShipmentAlert,
  type AdminBlock,
  type AdminChatPage,
  type AdminShipmentCounts,
  type AdminShipmentDetailResponse,
  type AdminShipmentPage,
  type AdminShipmentRow,
} from "@movo/shared/src/types/admin-shipments"
import { ShipmentStatus } from "@movo/shared/src/types/shipment"
import { MOCK_SHIPMENTS } from "./fixtures"

/**
 * Modo fixtures de Envíos (`MOVO_ADMIN_MOCK=1`, nunca en producción), mismo criterio que Usuarios:
 * reemplaza solo `lib/shipments/api.ts`. Reproduce los filtros, el cursor y los conteos de
 * `svc-shipments`. `MOVO_ADMIN_MOCK_FAIL=payment,parties,events,offers,chat,list` hace fallar ese bloque
 * con 502 en la primera carga (el reintento anda); con `!` (`payment!`) falla siempre.
 */
export const mockEnabled = () =>
  process.env.MOVO_ADMIN_MOCK === "1" && process.env.NODE_ENV !== "production"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const latency = () => {
  const n = Number(process.env.MOVO_ADMIN_MOCK_LATENCY_MS)
  return Number.isFinite(n) && n >= 0 ? n : 350
}

const failedOnce = new Set<string>()
function shouldFail(key: string): boolean {
  const keys = (process.env.MOVO_ADMIN_MOCK_FAIL ?? "")
    .split(",")
    .map((k) => k.trim())
  if (keys.includes(`${key}!`)) return true
  if (!keys.includes(key) || failedOnce.has(key)) return false
  failedOnce.add(key)
  return true
}

const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()

function toRow(detail: AdminShipmentRow): AdminShipmentRow {
  return {
    id: detail.id,
    code: detail.code,
    status: detail.status,
    sender: detail.sender,
    carrier: detail.carrier,
    receiver: detail.receiver,
    pickupCity: detail.pickupCity,
    pickupAddress: detail.pickupAddress,
    deliveryCity: detail.deliveryCity,
    deliveryAddress: detail.deliveryAddress,
    pickupDate: detail.pickupDate,
    pickupTimeWindowStart: detail.pickupTimeWindowStart,
    pickupTimeWindowEnd: detail.pickupTimeWindowEnd,
    priceArs: detail.priceArs,
    priceKind: detail.priceKind,
    lastStatusChangeAt: detail.lastStatusChangeAt,
    delayed: detail.delayed,
    disputeId: detail.disputeId,
    fundingDeadline: detail.fundingDeadline,
    redesignationDeadline: detail.redesignationDeadline,
  }
}

export async function mockListShipments(
  query: URLSearchParams
): Promise<AdminShipmentPage> {
  await sleep(latency())
  if (shouldFail("list"))
    throw new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "mock")

  const q = normalize((query.get("q") ?? "").replace(/^#/, ""))
  const city = normalize(query.get("city") ?? "")
  const from = query.get("from")
  const to = query.get("to")
  const alert = query.get("alert") === "true"
  const searched = MOCK_SHIPMENTS.map((s) => s.detail).filter((d) => {
    if (city && normalize(d.pickupCity ?? "") !== city) return false
    if (from && d.lastStatusChangeAt < from) return false
    if (to && d.lastStatusChangeAt > to) return false
    if (alert && !isAdminShipmentAlert(d)) return false
    if (!q) return true
    return [
      d.code,
      d.sender.name,
      d.carrier?.name,
      d.receiver.name,
      d.pickupAddress,
      d.deliveryAddress,
    ]
      .filter((v): v is string => !!v)
      .some((v) => normalize(v).includes(q))
  })

  const group = query.get("group") as
    keyof typeof ADMIN_SHIPMENT_GROUP_STATUSES | null
  const status = query.get("status")
  const statuses: readonly string[] = status
    ? [status]
    : group
      ? ADMIN_SHIPMENT_GROUP_STATUSES[group]
      : ACTIVE_SHIPMENT_STATUSES
  const listed = searched
    .filter((d) => statuses.includes(d.status))
    .sort((a, b) => b.lastStatusChangeAt.localeCompare(a.lastStatusChangeAt))

  const limit = Number(query.get("limit") ?? 25)
  const offset = Number((query.get("cursor") ?? "o0").slice(1)) || 0
  const items = listed.slice(offset, offset + limit).map(toRow)

  const tally = (rows: AdminShipmentRow[]): AdminShipmentCounts => {
    const of = (list: readonly string[]) =>
      rows.filter((r) => list.includes(r.status)).length
    const counts = { all: of(ACTIVE_SHIPMENT_STATUSES) } as AdminShipmentCounts
    for (const g of ADMIN_SHIPMENT_GROUPS)
      counts[g] = of(ADMIN_SHIPMENT_GROUP_STATUSES[g])
    return counts
  }
  const statusCounts = Object.fromEntries(
    Object.values(ShipmentStatus).map((s) => [
      s,
      searched.filter((d) => d.status === s).length,
    ])
  ) as AdminShipmentPage["statusCounts"]

  return {
    items,
    nextCursor: offset + limit < listed.length ? `o${offset + limit}` : null,
    counts: tally(searched),
    statusCounts,
    alertCounts: tally(searched.filter(isAdminShipmentAlert)),
  }
}

const block = <T>(key: string, data: T): AdminBlock<T> =>
  shouldFail(key)
    ? {
        data: null,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "El servicio no respondió.",
        },
      }
    : { data, error: null }

const find = (id: string) => {
  const found = MOCK_SHIPMENTS.find((s) => s.detail.id === id)
  if (!found) throw new ApiError(404, "NOT_FOUND", "mock")
  return found
}

export async function mockGetShipment(
  id: string
): Promise<AdminShipmentDetailResponse> {
  await sleep(latency())
  const s = find(id)
  return {
    shipment: s.detail,
    events: block("events", s.events),
    photos: block("photos", []),
    offers: block("offers", s.offers),
    payment: block("payment", s.payment),
    parties: block("parties", s.parties),
  }
}

export async function mockGetShipmentChat(
  id: string,
  cursor: string | null
): Promise<AdminChatPage> {
  await sleep(latency() * 1.5)
  if (shouldFail("chat"))
    throw new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "mock")
  const s = find(id)
  const offset = Number((cursor ?? "o0").slice(1)) || 0
  // Páginas chicas a propósito, para que se vea "Ver mensajes anteriores".
  const size = 6
  return {
    ...s.chat,
    items: s.chat.items.slice(offset, offset + size),
    nextCursor:
      offset + size < s.chat.items.length ? `o${offset + size}` : null,
    events: s.events,
  }
}
