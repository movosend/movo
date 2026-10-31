import {
  DisputeReason,
  DisputeStatus,
  type DisputeOutcome,
  type DisputePaymentAction,
  type DisputePhoto,
  type DisputeStatement,
} from "@movo/shared/src/types/dispute"
import type {
  AdminDisputeHandshakeEvent,
  AdminDisputeNote,
  AdminDisputeResolution,
  AdminDisputeResolutionPreview,
} from "@movo/shared/src/types/admin-disputes"
import type {
  AdminDisputeAttribution,
  AdminDisputeDetail,
  AdminDisputePartyHistory,
} from "@movo/shared/src/types/admin-disputes"
import type { AdminShipmentPhoto } from "@movo/shared/src/types/admin-shipments"
import { shipmentConfirmationCode } from "@movo/shared/src/types/admin-shipments"
import { DISPUTE_PARTIAL_PRESETS } from "@movo/shared/src/types/dispute"
import { MOCK_SHIPMENTS } from "@/lib/shipments/fixtures"

/**
 * Disputas del prototipo (`Movo Admin Disputas`) como datos del contrato de MOVO-337/341, para el modo
 * fixtures (`MOVO_ADMIN_MOCK=1`). Cuelgan de los envíos de `lib/shipments/fixtures.ts`, así el
 * expediente reutiliza el pago, el chat y el mapa de esos envíos.
 */
const NOW = Date.now()
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const DAY = 24 * 60

const did = (n: number) =>
  `d15b07e5-0000-4000-8000-${String(n).padStart(12, "0")}`
const img = (id: string) => `/api/support/mock-image/${id}`

export interface MockDispute {
  detail: AdminDisputeDetail
  handshake: AdminDisputeHandshakeEvent[]
  photos: AdminShipmentPhoto[]
  notes: AdminDisputeNote[]
  preview: AdminDisputeResolutionPreview
  /** Pago fallido pendiente de reintento (`resolving`): lo que el panel muestra en la franja. */
  paymentError: string | null
}

type Spec = {
  n: number
  shipmentIndex: number
  /** Estados de envío de los que se elige el envío (el primero que coincida con `shipmentIndex`). */
  pick?: string[]
  status: DisputeStatus
  reason: DisputeReason
  openedByRole: "sender" | "receiver" | "carrier" | null
  atOpen: "assigned" | "in_transit" | "delivered" | "completed"
  stake: number
  openedMinutesAgo: number
  description: string
  statements?: Array<{
    role: "sender" | "receiver" | "carrier"
    kind: "statement" | "amendment"
    text: string
    minutesAgo: number
    photos?: number
  }>
  openPhotos?: number
  resolved?: {
    outcome: DisputeOutcome
    percentage?: number
    reasoning: string
    minutesAgo: number
  }
  attribution?: AdminDisputeAttribution
  notes?: Array<{ body: string; minutesAgo: number }>
  paymentError?: string
}

const PARTIAL = [...DISPUTE_PARTIAL_PRESETS]

const payAction = (
  atOpen: Spec["atOpen"],
  outcome: DisputeOutcome
): DisputePaymentAction => {
  if (atOpen === "assigned")
    return outcome === "sender" ? "none" : "ledger_credit"
  if (atOpen === "in_transit")
    return outcome === "sender"
      ? "release_hold"
      : outcome === "carrier"
        ? "capture_hold"
        : "capture_partial"
  return outcome === "sender"
    ? "refund_full"
    : outcome === "carrier"
      ? "none"
      : "refund_partial"
}

const shipmentAt = (status: string[], index = 0) => {
  const list = MOCK_SHIPMENTS.filter((s) => status.includes(s.detail.status))
  return list[index % Math.max(list.length, 1)] ?? MOCK_SHIPMENTS[0]!
}

const SPECS: Spec[] = [
  {
    n: 42,
    pick: ["disputed"],
    shipmentIndex: 0,
    status: DisputeStatus.OPEN,
    reason: DisputeReason.DAMAGED,
    openedByRole: "receiver",
    atOpen: "completed",
    stake: 8700,
    openedMinutesAgo: 2 * DAY + 180,
    description:
      "La lámpara llegó partida. Adjunto fotos de la caja y del contenido.",
    openPhotos: 3,
    statements: [
      {
        role: "carrier",
        kind: "statement",
        text: "La caja estaba cerrada y sin golpes cuando la entregué. El receptor la abrió delante mío y no dijo nada.",
        minutesAgo: 1 * DAY + 240,
        photos: 1,
      },
    ],
    notes: [
      { body: "Pedir al emisor el comprobante del embalaje.", minutesAgo: 90 },
    ],
  },
  {
    n: 41,
    pick: ["in_transit"],
    shipmentIndex: 0,
    status: DisputeStatus.OPEN,
    reason: DisputeReason.NOT_DELIVERED,
    openedByRole: "sender",
    atOpen: "in_transit",
    stake: 6900,
    openedMinutesAgo: 5 * DAY,
    description:
      "Marqué el paquete como entregado pero el receptor dice que nunca lo recibió.",
    statements: [],
  },
  {
    n: 40,
    pick: ["in_transit"],
    shipmentIndex: 1,
    status: DisputeStatus.OPEN,
    reason: DisputeReason.TRANSIT_ANOMALY,
    openedByRole: null,
    atOpen: "in_transit",
    stake: 7100,
    openedMinutesAgo: 9 * 60,
    description:
      "El envío lleva más de 6 horas sin movimiento ni señal del transportista.",
    attribution: {
      reason: "transit_anomaly",
      attributedTo: null,
      summary:
        "Sin señal del transportista hace más de 6 h con el envío en camino. El barrido no atribuye culpa: lo resuelve el equipo.",
      sweptAt: ago(9 * 60),
      positions: [],
      farPositionsInWindow: 0,
      grayPositionsInWindow: 0,
      lastPingAt: ago(9 * 60 + 380),
    },
  },
  {
    n: 39,
    pick: ["assigned"],
    shipmentIndex: 2,
    status: DisputeStatus.OPEN,
    reason: DisputeReason.PICKUP_NO_SHOW,
    openedByRole: null,
    atOpen: "assigned",
    stake: 5400,
    openedMinutesAgo: 3 * DAY,
    description:
      "El transportista llegó al punto de retiro pero no hubo handshake dentro del plazo.",
    attribution: {
      reason: "pickup_no_show",
      attributedTo: "sender",
      summary:
        "El transportista llegó (3 lecturas a menos de 250 m) y no hubo retiro: el barrido atribuye el no-retiro al emisor.",
      sweptAt: ago(3 * DAY),
      lastPingAt: null,
      positions: [
        {
          lat: -31.4108,
          lng: -64.2032,
          accuracyM: 12,
          capturedAt: ago(3 * DAY + 130),
          class: "arrival",
        },
        {
          lat: -31.4109,
          lng: -64.2031,
          accuracyM: 9,
          capturedAt: ago(3 * DAY + 105),
          class: "arrival",
        },
        {
          lat: -31.4107,
          lng: -64.2033,
          accuracyM: 14,
          capturedAt: ago(3 * DAY + 80),
          class: "arrival",
        },
        {
          lat: -31.4151,
          lng: -64.1989,
          accuracyM: 30,
          capturedAt: ago(3 * DAY + 60),
          class: "gray",
        },
      ],
      farPositionsInWindow: 0,
      grayPositionsInWindow: 1,
    },
  },
  {
    n: 38,
    pick: ["completed"],
    shipmentIndex: 3,
    status: DisputeStatus.RESOLVING,
    reason: DisputeReason.WRONG_DELIVERY,
    openedByRole: "sender",
    atOpen: "completed",
    stake: 6900,
    openedMinutesAgo: 6 * DAY,
    description: "Entregaron el paquete a otra persona, no al receptor.",
    resolved: {
      outcome: "sender",
      reasoning:
        "El handshake de entrega se cerró a 340 m del domicilio y el receptor no lo confirmó.",
      minutesAgo: 25,
    },
    paymentError:
      "Mercado Pago no confirmó el reembolso. El resultado quedó guardado y se puede reintentar con los mismos datos.",
  },
  {
    n: 37,
    pick: ["delivered"],
    shipmentIndex: 4,
    status: DisputeStatus.RESOLVED,
    reason: DisputeReason.DAMAGED,
    openedByRole: "receiver",
    atOpen: "in_transit",
    stake: 8000,
    openedMinutesAgo: 12 * DAY,
    description: "El electrodoméstico llegó con la pantalla rota.",
    openPhotos: 2,
    statements: [
      {
        role: "carrier",
        kind: "statement",
        text: "El paquete ya tenía la caja abollada al retirarlo; lo avisé por el chat.",
        minutesAgo: 11 * DAY,
      },
    ],
    resolved: {
      outcome: "partial",
      percentage: 50,
      reasoning:
        "La caja ya estaba dañada al retiro (fotos del emisor) pero el transportista no lo dejó asentado.",
      minutesAgo: 9 * DAY,
    },
  },
  {
    n: 36,
    pick: ["completed"],
    shipmentIndex: 5,
    status: DisputeStatus.RESOLVED,
    reason: DisputeReason.NOT_DELIVERED,
    openedByRole: "sender",
    atOpen: "completed",
    stake: 7100,
    openedMinutesAgo: 20 * DAY,
    description: "El receptor dice que no llegó nada.",
    resolved: {
      outcome: "carrier",
      reasoning: "La traza GPS y el QR del receptor confirman la entrega.",
      minutesAgo: 18 * DAY,
    },
  },
]

// Más disputas abiertas para que la bandeja pagine (de a 25).
for (let i = 0; i < 28; i += 1) {
  SPECS.push({
    n: 100 + i,
    shipmentIndex: 6 + i,
    status: DisputeStatus.OPEN,
    reason: [
      DisputeReason.DAMAGED,
      DisputeReason.NOT_DELIVERED,
      DisputeReason.OTHER,
      DisputeReason.WRONG_DELIVERY,
    ][i % 4]!,
    openedByRole: (["sender", "receiver", "carrier"] as const)[i % 3]!,
    atOpen: (["completed", "in_transit", "delivered"] as const)[i % 3]!,
    stake: 4000 + (i % 7) * 900,
    openedMinutesAgo: 4 * 60 + i * 5 * 60,
    description: "Reclamo de ejemplo para probar el paginado de la bandeja.",
    statements: [],
  })
}

function history(
  detail: Pick<AdminDisputeDetail, "sender" | "carrier" | "receiver">,
  n: number
): AdminDisputePartyHistory[] {
  const rows: AdminDisputePartyHistory[] = [
    {
      userId: detail.sender.id,
      role: "sender",
      opened: 2 + (n % 3),
      lost: n % 2,
      open: 1,
    },
    {
      userId: detail.receiver.id,
      role: "receiver",
      opened: 1,
      lost: 0,
      open: 1,
    },
  ]
  if (detail.carrier)
    rows.push({
      userId: detail.carrier.id,
      role: "carrier",
      opened: 0,
      lost: n % 2,
      open: 1,
    })
  return rows
}

function build(spec: Spec): MockDispute {
  const ship = shipmentAt(
    spec.pick ?? [
      "completed",
      "delivered",
      "in_transit",
      "assigned",
      "cancelled",
    ],
    spec.shipmentIndex
  )
  const s = ship.detail
  const id = did(spec.n)
  const party = (u: { id: string; name: string | null }) => ({
    id: u.id,
    name: u.name,
  })
  const roleToUser = {
    sender: s.sender,
    receiver: s.receiver,
    carrier: s.carrier ?? s.sender,
  }

  const photoOf = (k: string, i: number): DisputePhoto => ({
    id: `${id}-${k}${i}`,
    url: img(`${id}-${k}${i}`),
    expiresIn: 300,
  })
  const statements: DisputeStatement[] = (spec.statements ?? []).map(
    (st, i) => ({
      id: `${id}-st${i}`,
      authorId: roleToUser[st.role].id,
      authorRole: st.role,
      kind: st.kind,
      text: st.text,
      photos: Array.from({ length: st.photos ?? 0 }, (_, p) =>
        photoOf(`s${i}-`, p)
      ),
      createdAt: ago(st.minutesAgo),
    })
  )

  let resolution: AdminDisputeResolution | null = null
  if (spec.resolved) {
    const stake = spec.stake
    const carrier =
      spec.resolved.outcome === "carrier"
        ? stake
        : spec.resolved.outcome === "sender"
          ? 0
          : Math.round((stake * (spec.resolved.percentage ?? 50)) / 100)
    resolution = {
      outcome: spec.resolved.outcome,
      reasoning: spec.resolved.reasoning,
      percentage: spec.resolved.percentage ?? null,
      carrierAmountArs: carrier,
      senderAmountArs: stake - carrier,
      paymentAction: payAction(spec.atOpen, spec.resolved.outcome),
      resolvedBy: "Tomás Ferreyra",
      resolvedAt:
        spec.status === DisputeStatus.RESOLVED
          ? ago(spec.resolved.minutesAgo)
          : null,
    }
  }

  const detail: AdminDisputeDetail = {
    id,
    shipmentId: s.id,
    shipmentCode: shipmentConfirmationCode(s.id),
    status: spec.status,
    reason: spec.reason,
    openedByRole: spec.openedByRole,
    openedAt: ago(spec.openedMinutesAgo),
    shipmentStatusAtOpen: spec.atOpen,
    shipmentStatus:
      spec.status === DisputeStatus.RESOLVED ? "completed" : "disputed",
    sender: party(s.sender),
    carrier: s.carrier ? party(s.carrier) : null,
    receiver: party(s.receiver),
    outcome: resolution?.outcome ?? null,
    description: spec.description,
    photos: Array.from({ length: spec.openPhotos ?? 0 }, (_, i) =>
      photoOf("o", i)
    ),
    statements,
    resolution,
    pickupCity: s.pickupCity,
    partyHistory: [],
    attribution: spec.attribution ?? null,
  }
  detail.partyHistory = history(detail, spec.n)

  const minimum =
    spec.atOpen === "in_transit" ? Math.round(spec.stake * 0.2) : null
  const preview: AdminDisputeResolutionPreview = {
    statusAtOpen: spec.atOpen,
    stakeArs: spec.stake,
    minimumPartialArs: minimum,
    outcomes: (["sender", "carrier", "partial"] as const).map((outcome) => ({
      outcome,
      paymentAction: payAction(spec.atOpen, outcome),
      shipmentStatus: outcome === "sender" ? "cancelled" : "completed",
    })),
    presets: PARTIAL.map((percentage) => {
      const carrierAmountArs = Math.round((spec.stake * percentage) / 100)
      return {
        percentage,
        carrierAmountArs,
        senderAmountArs: spec.stake - carrierAmountArs,
        belowMinimum: minimum !== null && carrierAmountArs < minimum,
      }
    }),
  }

  const handshake: AdminDisputeHandshakeEvent[] = [
    {
      id: `${id}-h1`,
      stage: "pickup",
      actorId: s.sender.id,
      counterpartyId: s.carrier?.id ?? s.receiver.id,
      distanceM: 14,
      createdAt: ago(spec.openedMinutesAgo + 4 * 60),
    },
    ...(spec.atOpen === "assigned" || spec.atOpen === "in_transit"
      ? []
      : [
          {
            id: `${id}-h2`,
            stage: "delivery",
            actorId: s.carrier?.id ?? s.sender.id,
            counterpartyId: s.receiver.id,
            distanceM: spec.status === DisputeStatus.RESOLVING ? 340 : 22,
            createdAt: ago(spec.openedMinutesAgo + 60),
          },
        ]),
  ]
  if (spec.atOpen === "assigned") handshake.length = 0

  const photos: AdminShipmentPhoto[] = [
    {
      id: `${id}-p1`,
      stage: "pickup",
      url: img(`${id}-p1`),
      createdAt: ago(spec.openedMinutesAgo + 4 * 60),
    },
    ...(spec.atOpen === "completed" || spec.atOpen === "delivered"
      ? [
          {
            id: `${id}-p2`,
            stage: "delivery" as const,
            url: img(`${id}-p2`),
            createdAt: ago(spec.openedMinutesAgo + 60),
          },
        ]
      : []),
  ]
  if (spec.atOpen === "assigned") photos.length = 0

  const notes: AdminDisputeNote[] = (spec.notes ?? []).map((note, i) => ({
    id: `${id}-n${i}`,
    disputeId: id,
    adminId: "mock-admin",
    adminName: "Tomás Ferreyra",
    body: note.body,
    createdAt: ago(note.minutesAgo),
  }))

  return {
    detail,
    handshake,
    photos,
    notes,
    preview,
    paymentError: spec.paymentError ?? null,
  }
}

export const MOCK_DISPUTES: MockDispute[] = SPECS.map(build)

/** La disputa abierta o en curso de un envío (`AdminShipmentDetail.disputeId`), para el modo fixtures de Envíos. */
export const mockDisputeIdOf = (shipmentId: string): string | null =>
  MOCK_DISPUTES.find(
    (d) => d.detail.shipmentId === shipmentId && d.detail.status !== "resolved"
  )?.detail.id ?? null
