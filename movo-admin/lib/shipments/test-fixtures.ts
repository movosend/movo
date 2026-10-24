import type {
  AdminChatMessage,
  AdminShipmentDetail,
  AdminShipmentEvent,
  AdminShipmentOffer,
  AdminShipmentRow,
} from "@movo/shared/src/types/admin-shipments"

/** Datos chicos para los tests de Envíos (no son los fixtures del modo mock). */
export const SENDER = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ana Molina",
}
export const CARRIER = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Diego Funes",
}
export const RECEIVER = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Luis Herrera",
}

export const NOW = new Date("2026-10-21T15:00:00.000Z") // 12:00 en Argentina

export const row = (
  over: Partial<AdminShipmentRow> = {}
): AdminShipmentRow => ({
  id: "4800bc55-a000-4000-8000-000000048213",
  code: "4800bc55",
  status: "in_transit",
  sender: SENDER,
  carrier: CARRIER,
  receiver: RECEIVER,
  pickupCity: "Córdoba",
  pickupAddress: "Av. Colón 1234, Alberdi",
  deliveryCity: "Villa Allende",
  deliveryAddress: "Av. San Martín 1200",
  pickupDate: "2026-10-21",
  pickupTimeWindowStart: "09:00",
  pickupTimeWindowEnd: "12:00",
  priceArs: 6800,
  priceKind: "agreed",
  lastStatusChangeAt: "2026-10-21T14:54:00.000Z",
  delayed: false,
  disputeId: null,
  fundingDeadline: null,
  redesignationDeadline: null,
  ...over,
})

export const detail = (
  over: Partial<AdminShipmentDetail> = {}
): AdminShipmentDetail => ({
  ...row(),
  packageType: "standard_package",
  weightKg: 3,
  lengthCm: 30,
  widthCm: 20,
  heightCm: 15,
  description: "Ropa",
  urgent: false,
  requestedPickupDate: "2026-10-21",
  requestedPickupTimeWindowStart: "09:00",
  requestedPickupTimeWindowEnd: "12:00",
  pickupLat: -31.41,
  pickupLng: -64.2,
  deliveryLat: -31.29,
  deliveryLng: -64.29,
  suggestedPriceArs: 6800,
  agreedPriceArs: 6800,
  paymentMethod: "card",
  highDemand: false,
  estimatedDeliveryDate: null,
  deliveredAt: null,
  receiverConfirmationDeadline: null,
  transitAnomalyFlaggedAt: null,
  chatStartedAt: "2026-10-20T21:10:00.000Z",
  cancellationPenaltyArs: null,
  createdAt: "2026-10-20T18:42:00.000Z",
  ...over,
})

/** Oferta aceptada de Diego por $6.800 (bruto); el resto con el 15% de Movo y el 4,99% estimado de MP. */
export const offer = (
  over: Partial<AdminShipmentOffer> = {}
): AdminShipmentOffer => ({
  id: "af26aeae-0695-409d-a5df-d5d9665f59b9",
  carrierId: CARRIER.id,
  carrierName: CARRIER.name,
  carrierRatingAtOffer: 4.8,
  status: "accepted",
  priceArs: 6800,
  netArs: 5913.04,
  commissionArs: 886.96,
  commissionRate: 0.15,
  mpFeeEstimateArs: 339.32,
  receivedEstimateArs: 5573.72,
  offeredDate: "2026-10-21",
  pickupTimeWindowStart: null,
  pickupTimeWindowEnd: null,
  estimatedDeliveryDate: "2026-10-21",
  estimatedDeliveryTimeWindowStart: "16:00",
  estimatedDeliveryTimeWindowEnd: "19:00",
  message: "Paso temprano",
  tripId: null,
  createdAt: "2026-10-20T19:00:00.000Z",
  viewedAtBySender: "2026-10-20T19:20:00.000Z",
  respondedAt: "2026-10-20T21:12:00.000Z",
  expiresAt: null,
  ...over,
})

let seq = 0
export const event = (
  toStatus: AdminShipmentEvent["toStatus"],
  createdAt: string,
  over: Partial<AdminShipmentEvent> = {}
): AdminShipmentEvent => ({
  id: `ev-${++seq}`,
  fromStatus: null,
  toStatus,
  actorId: null,
  actorName: null,
  reason: null,
  kind: "normal",
  createdAt,
  ...over,
})

export const message = (
  body: string,
  createdAt: string,
  author = SENDER,
  over: Partial<AdminChatMessage> = {}
): AdminChatMessage => ({
  id: `m-${++seq}`,
  authorId: author.id,
  authorName: author.name,
  authorRole:
    author === SENDER ? "sender" : author === CARRIER ? "carrier" : "receiver",
  body,
  moderated: false,
  createdAt,
  ...over,
})
