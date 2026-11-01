import "server-only"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  DisputeStatus,
  type ResolveDisputeRequest,
  type ResolveDisputeResponse,
} from "@movo/shared/src/types/dispute"
import {
  disputeFinalShipmentStatus,
  splitDisputeStake,
} from "@movo/shared/src/config/dispute-resolution"
import type {
  AdminDisputeHandshakeEvent,
  AdminDisputeNote,
  AdminDisputeNotePage,
  AdminDisputePage,
  AdminDisputeResolutionPreview,
  AdminDisputeRow,
  AdminDisputePhotos,
} from "@movo/shared/src/types/admin-disputes"
import type { AdminDisputeDetail } from "@movo/shared/src/types/admin-disputes"
import { latency, mockEnabled, shouldFail, sleep } from "@/lib/shipments/mock"
import { MOCK_DISPUTES, type MockDispute } from "./fixtures"

export { mockEnabled }

const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()

const unavailable = () =>
  new ApiError(
    502,
    "SHIPMENTS_SERVICE_UNAVAILABLE",
    "El servicio no respondió."
  )

const find = (id: string): MockDispute => {
  const found = MOCK_DISPUTES.find((d) => d.detail.id === id)
  if (!found) throw new ApiError(404, "DISPUTE_NOT_FOUND", "mock")
  return found
}

function toRow(d: AdminDisputeDetail): AdminDisputeRow {
  return {
    id: d.id,
    shipmentId: d.shipmentId,
    shipmentCode: d.shipmentCode,
    status: d.status,
    reason: d.reason,
    openedByRole: d.openedByRole,
    openedAt: d.openedAt,
    shipmentStatusAtOpen: d.shipmentStatusAtOpen,
    shipmentStatus: d.shipmentStatus,
    sender: d.sender,
    carrier: d.carrier,
    receiver: d.receiver,
    outcome: d.outcome,
    pickupCity: d.pickupCity,
  }
}

export async function mockListDisputes(
  query: URLSearchParams
): Promise<AdminDisputePage> {
  await sleep(latency())
  if (shouldFail("list")) throw unavailable()
  const q = normalize((query.get("q") ?? "").replace(/^#/, ""))
  const city = normalize(query.get("city") ?? "")
  const reason = query.get("reason")
  const from = query.get("from")
  const to = query.get("to")
  const searched = MOCK_DISPUTES.map((m) => m.detail).filter((d) => {
    if (city && !normalize(d.pickupCity ?? "").includes(city)) return false
    if (reason && d.reason !== reason) return false
    if (from && d.openedAt < from) return false
    if (to && d.openedAt > to) return false
    if (!q) return true
    return [d.shipmentCode, d.sender.name, d.carrier?.name, d.receiver.name]
      .filter((v): v is string => !!v)
      .some((v) => normalize(v).includes(q))
  })
  const status = (query.get("status") ?? DisputeStatus.OPEN) as DisputeStatus
  const newest = query.get("sort") === "newest"
  const listed = searched
    .filter((d) => d.status === status)
    .sort((a, b) =>
      newest
        ? b.openedAt.localeCompare(a.openedAt)
        : a.openedAt.localeCompare(b.openedAt)
    )
  const limit = Number(query.get("limit") ?? 25)
  const offset = Number((query.get("cursor") ?? "o0").slice(1)) || 0
  const count = (s: DisputeStatus) =>
    searched.filter((d) => d.status === s).length
  return {
    items: listed.slice(offset, offset + limit).map(toRow) as AdminDisputeRow[],
    nextCursor: offset + limit < listed.length ? `o${offset + limit}` : null,
    statusCounts: {
      [DisputeStatus.OPEN]: count(DisputeStatus.OPEN),
      [DisputeStatus.RESOLVING]: count(DisputeStatus.RESOLVING),
      [DisputeStatus.RESOLVED]: count(DisputeStatus.RESOLVED),
    },
  }
}

export async function mockGetDispute(
  id: string
): Promise<AdminDisputeDetail> {
  await sleep(latency())
  if (shouldFail("dispute")) throw unavailable()
  return find(id).detail
}

export async function mockDisputePhotos(
  id: string
): Promise<AdminDisputePhotos> {
  await sleep(latency())
  if (shouldFail("photos")) throw unavailable()
  return find(id).photos
}

export async function mockDisputeHandshake(
  id: string
): Promise<AdminDisputeHandshakeEvent[]> {
  await sleep(latency())
  if (shouldFail("handshake")) throw unavailable()
  return find(id).handshake
}

export async function mockDisputeNotes(
  id: string,
  cursor: string | null
): Promise<AdminDisputeNotePage> {
  await sleep(latency())
  if (shouldFail("notes")) throw unavailable()
  const all = [...find(id).notes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
  const offset = Number((cursor ?? "o0").slice(1)) || 0
  const size = 5
  return {
    items: all.slice(offset, offset + size),
    nextCursor: offset + size < all.length ? `o${offset + size}` : null,
  }
}

export async function mockDisputePreview(
  id: string
): Promise<AdminDisputeResolutionPreview> {
  await sleep(latency())
  if (shouldFail("preview")) throw unavailable()
  return find(id).preview
}

export async function mockAddDisputeNote(
  id: string,
  body: string
): Promise<AdminDisputeNote> {
  await sleep(latency())
  if (shouldFail("actions!")) throw unavailable()
  const dispute = find(id)
  const note: AdminDisputeNote = {
    id: `${id}-n${dispute.notes.length}-${Date.now()}`,
    disputeId: id,
    adminId: "mock-admin",
    adminName: "Tomás Ferreyra",
    body,
    createdAt: new Date().toISOString(),
  }
  dispute.notes.push(note)
  return note
}

/**
 * Resolver en el modo fixtures: valida como `svc-admin` (422 con el mínimo), y `MOVO_ADMIN_MOCK_FAIL=resolve`
 * deja la disputa `resolving` con `DISPUTE_PAYMENT_FAILED` la primera vez; el reintento con los mismos datos sale bien.
 */
export async function mockResolveDispute(
  id: string,
  request: ResolveDisputeRequest
): Promise<ResolveDisputeResponse> {
  await sleep(latency() * 2)
  const dispute = find(id)
  const { detail, preview } = dispute
  const saved = detail.resolution
  if (detail.status === DisputeStatus.RESOLVED)
    throw new ApiError(409, "DISPUTE_NOT_OPEN", "La disputa ya está resuelta.")
  if (saved && saved.outcome !== request.outcome)
    throw new ApiError(
      409,
      "DISPUTE_RESOLUTION_MISMATCH",
      "La disputa ya tiene otro resultado guardado."
    )

  const split = splitDisputeStake(preview.stakeArs, request.outcome, {
    ...(request.percentage !== undefined && { percentage: request.percentage }),
    ...(request.amountArs !== undefined && { amountArs: request.amountArs }),
  })
  if ("error" in split) {
    if (split.error === "above_maximum")
      throw new ApiError(
        422,
        "DISPUTE_PARTIAL_ABOVE_MAXIMUM",
        "El monto supera lo que hay en juego.",
        {
          maximumArs: preview.stakeArs,
        }
      )
    throw new ApiError(
      400,
      "DISPUTE_PARTIAL_INVALID",
      "El resultado parcial es inválido."
    )
  }
  if (
    detail.status === DisputeStatus.OPEN &&
    preview.minimumPartialArs !== null &&
    request.outcome === "partial" &&
    split.carrierAmountArs < preview.minimumPartialArs
  )
    throw new ApiError(
      422,
      "DISPUTE_PARTIAL_BELOW_MINIMUM",
      "La captura no cubre la comisión.",
      { minimumArs: preview.minimumPartialArs }
    )

  const paymentAction = preview.outcomes.find(
    (o) => o.outcome === request.outcome
  )!.paymentAction
  detail.resolution = {
    outcome: request.outcome,
    reasoning: request.reasoning.trim(),
    percentage: request.percentage ?? null,
    carrierAmountArs: split.carrierAmountArs,
    senderAmountArs: split.senderAmountArs,
    paymentAction,
    resolvedBy: "Tomás Ferreyra",
    resolvedAt: null,
  }
  detail.outcome = request.outcome

  if (shouldFail("resolve")) {
    detail.status = DisputeStatus.RESOLVING
    dispute.paymentError =
      "Mercado Pago no confirmó la acción de pago. El resultado quedó guardado y se puede reintentar con los mismos datos."
    throw new ApiError(502, "DISPUTE_PAYMENT_FAILED", dispute.paymentError)
  }

  const replayed = detail.status === DisputeStatus.RESOLVING
  const resolvedAt = new Date().toISOString()
  detail.status = DisputeStatus.RESOLVED
  detail.shipmentStatus = disputeFinalShipmentStatus(request.outcome)
  detail.resolution.resolvedAt = resolvedAt
  dispute.paymentError = null
  return {
    disputeId: id,
    shipmentId: detail.shipmentId,
    outcome: request.outcome,
    reasoning: detail.resolution.reasoning,
    carrierAmountArs: split.carrierAmountArs,
    senderAmountArs: split.senderAmountArs,
    paymentAction,
    status: DisputeStatus.RESOLVED,
    shipmentStatus: disputeFinalShipmentStatus(request.outcome),
    replayed,
    resolvedAt,
  }
}

export async function mockOpenDisputeCount(): Promise<number> {
  await sleep(latency() / 3)
  return MOCK_DISPUTES.filter((d) => d.detail.status === DisputeStatus.OPEN)
    .length
}
