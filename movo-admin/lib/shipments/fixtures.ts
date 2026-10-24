import type {
  AdminChatMessage,
  AdminChatPage,
  AdminShipmentDetail,
  AdminShipmentEvent,
  AdminShipmentOffer,
  AdminShipmentPartyCard,
  AdminShipmentPayment,
} from "@movo/shared/src/types/admin-shipments"
import {
  decomposeOfferGrossPrice,
  DEFAULT_MOVO_COMMISSION_RATE,
  estimateMpFeeArs,
  estimateReceivedArs,
} from "@movo/shared/src/config/commission"
import type { ShipmentStatusValue } from "./format"

/**
 * Los envíos del prototipo (`Movo Admin Envios.dc.html`) como datos del contrato de MOVO-325, para
 * el modo fixtures (`MOVO_ADMIN_MOCK=1`). Las horas son relativas al arranque del servidor, así
 * "hace 6 min" y "vence en 5 h" se leen igual que en el prototipo.
 */
const NOW = Date.now()
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const ahead = (minutes: number) =>
  new Date(NOW + minutes * 60_000).toISOString()
const dayOffset = (days: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(NOW + days * 86_400_000))

/** UUID estable a partir de un número (el código visible son sus primeros 8 caracteres). */
const uuid = (n: number, kind = "a") =>
  `${(0x48000000 + n).toString(16)}-${kind}000-4000-8000-${String(n).padStart(12, "0")}`

const PLACES: Array<[address: string, city: string, lat: number, lng: number]> =
  [
    ["Av. Colón 1234, Alberdi", "Córdoba", -31.4108, -64.2032],
    ["Bv. San Juan 450, Centro", "Córdoba", -31.4223, -64.1866],
    ["Rafael Núñez 4800, Cerro de las Rosas", "Córdoba", -31.3712, -64.2318],
    ["Obispo Trejo 1100, Nueva Córdoba", "Córdoba", -31.4318, -64.1889],
    ["Fragueiro 2600, Alta Córdoba", "Córdoba", -31.3934, -64.1782],
    ["Av. Sabattini 3500, Maldonado", "Córdoba", -31.4268, -64.1452],
    ["Av. San Martín 1200", "Villa Allende", -31.2948, -64.2953],
    ["Av. del Libertador 400", "Carlos Paz", -31.4241, -64.4978],
    ["Av. Richieri 3200, Jardín", "Córdoba", -31.4561, -64.1779],
    ["Av. Pablo Cabrera 3400, Villa Cabrera", "Córdoba", -31.3868, -64.2054],
    ["Rodríguez Peña 1800, General Paz", "Córdoba", -31.4089, -64.1661],
    ["Av. San Martín 900", "Río Cuarto", -33.1232, -64.3493],
    [
      "Av. Armada Argentina 900, Villa El Libertador",
      "Córdoba",
      -31.4718,
      -64.2138,
    ],
    ["Bv. Rivadavia 2100", "Villa María", -32.4075, -63.2402],
  ]

type Seed = {
  n: number
  status: ShipmentStatusValue
  from: number
  to: number
  sender: string
  carrier: string | null
  receiver: string
  price: number
  /** Días desde hoy y ventana de retiro. */
  pickup: [days: number, start: string, end: string]
  /** Minutos desde el último cambio de estado. */
  updated: number
  pkg: [type: string, kg: number, description: string]
  delayed?: boolean
  reason?: string
}

const SEEDS: Seed[] = [
  {
    n: 48213,
    status: "in_transit",
    from: 0,
    to: 5,
    sender: "Ana Molina",
    carrier: "Diego Funes",
    receiver: "Luis Herrera",
    price: 6800,
    pickup: [0, "09:00", "12:00"],
    updated: 6,
    pkg: ["standard_package", 3, "Ropa"],
  },
  {
    n: 48207,
    status: "in_transit",
    from: 2,
    to: 3,
    sender: "Sofía Ríos",
    carrier: "Marcos Vera",
    receiver: "Julia Peralta",
    price: 9200,
    pickup: [0, "08:00", "11:00"],
    updated: 14,
    pkg: ["letter_document", 1, "Documentos"],
  },
  {
    n: 48195,
    status: "in_transit",
    from: 9,
    to: 10,
    sender: "Facundo Gil",
    carrier: "Valentina Sosa",
    receiver: "Pedro Luna",
    price: 5900,
    pickup: [0, "07:30", "10:00"],
    updated: 9,
    pkg: ["standard_package", 8, "Hogar"],
    delayed: true,
  },
  {
    n: 48188,
    status: "in_transit",
    from: 6,
    to: 1,
    sender: "Martina Ruiz",
    carrier: "Gonzalo Díaz",
    receiver: "Emilia Vega",
    price: 11300,
    pickup: [0, "10:00", "13:00"],
    updated: 3,
    pkg: ["standard_package", 5, "Libros"],
  },
  {
    n: 48214,
    status: "assigned",
    from: 11,
    to: 13,
    sender: "Bruno Castro",
    carrier: "Agustina Ponce",
    receiver: "Lautaro Ríos",
    price: 6100,
    pickup: [0, "14:00", "17:00"],
    updated: 25,
    pkg: ["standard_package", 2, "Accesorios"],
  },
  {
    n: 48216,
    status: "assigned",
    from: 7,
    to: 12,
    sender: "Paula Méndez",
    carrier: "Ezequiel Rojas",
    receiver: "Brenda Arias",
    price: 8000,
    pickup: [0, "15:00", "18:00"],
    updated: 60,
    pkg: ["fragile_item", 3, "Vajilla"],
  },
  {
    n: 48201,
    status: "assigned_unfunded",
    from: 1,
    to: 6,
    sender: "Lucas Romero",
    carrier: "Tomás Aguirre",
    receiver: "Milagros Cruz",
    price: 7900,
    pickup: [4, "10:00", "13:00"],
    updated: 180,
    pkg: ["standard_package", 9, "Hogar"],
  },
  {
    n: 48219,
    status: "assignment_pending",
    from: 5,
    to: 2,
    sender: "Joaquín Herrera",
    carrier: "Mateo Ibarra",
    receiver: "Sol Navarro",
    price: 10500,
    pickup: [1, "09:00", "11:00"],
    updated: 12,
    pkg: ["standard_package", 4, "Regalo"],
  },
  {
    n: 48222,
    status: "published",
    from: 3,
    to: 9,
    sender: "Renata Silva",
    carrier: null,
    receiver: "Ignacio Ferrer",
    price: 6400,
    pickup: [1, "16:00", "19:00"],
    updated: 120,
    pkg: ["standard_package", 1, "Accesorios"],
  },
  {
    n: 48224,
    status: "awaiting_receiver_confirmation",
    from: 10,
    to: 0,
    sender: "Lorena Paz",
    carrier: null,
    receiver: "Ramiro Quiroga",
    price: 5200,
    pickup: [2, "09:00", "12:00"],
    updated: 40,
    pkg: ["standard_package", 2, "Ropa"],
  },
  {
    n: 48181,
    status: "rejected_by_receiver",
    from: 0,
    to: 9,
    sender: "Gabriel Ledesma",
    carrier: null,
    receiver: "Victoria Campos",
    price: 6300,
    pickup: [1, "10:00", "12:00"],
    updated: 300,
    pkg: ["standard_package", 2, "Regalo"],
    reason: "No conozco a esta persona.",
  },
  {
    n: 48176,
    status: "disputed",
    from: 8,
    to: 4,
    sender: "Florencia Díaz",
    carrier: "Hernán Molina",
    receiver: "Carolina Sánchez",
    price: 8700,
    pickup: [0, "08:00", "10:00"],
    updated: 120,
    pkg: ["fragile_item", 3, "Lámpara"],
    reason:
      "La lámpara llegó partida. Adjunto fotos de la caja y del contenido.",
  },
  {
    n: 48170,
    status: "delivered",
    from: 12,
    to: 7,
    sender: "Julián Torres",
    carrier: "Marcos Vera",
    receiver: "Abril Romero",
    price: 6900,
    pickup: [0, "07:00", "09:00"],
    updated: 130,
    pkg: ["letter_document", 1, "Documentos"],
  },
  {
    n: 48162,
    status: "completed",
    from: 13,
    to: 11,
    sender: "Micaela Luque",
    carrier: "Nicolás Paz",
    receiver: "Franco Vidal",
    price: 7100,
    pickup: [-1, "15:00", "18:00"],
    updated: 1500,
    pkg: ["standard_package", 4, "Electrónica"],
  },
  {
    n: 48158,
    status: "cancelled",
    from: 2,
    to: 10,
    sender: "Santiago Arce",
    carrier: null,
    receiver: "Daniela Moreno",
    price: 5600,
    pickup: [-1, "10:00", "13:00"],
    updated: 1600,
    pkg: ["standard_package", 1, "Ropa"],
    reason: "Ya no lo necesito enviar, lo llevo yo.",
  },
]

// Más volumen para probar la paginación: envíos cerrados viejos.
for (let i = 0; i < 40; i++) {
  const names = [
    "Abril Ramos",
    "Bautista Ojeda",
    "Clara Funes",
    "Dante Ferreyra",
    "Elena Quinteros",
  ]
  SEEDS.push({
    n: 47000 + i,
    status: i % 7 === 0 ? "cancelled" : "completed",
    from: i % PLACES.length,
    to: (i + 5) % PLACES.length,
    sender: names[i % 5]!,
    carrier: i % 7 === 0 ? null : names[(i + 2) % 5]!,
    receiver: names[(i + 3) % 5]!,
    price: 4800 + i * 120,
    pickup: [-2 - i, "09:00", "12:00"],
    updated: 2 * 1440 + i * 1440,
    pkg: ["standard_package", 1 + (i % 6), "Varios"],
  })
}

const personId = (name: string) => {
  const n =
    [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 1_000_000
  return uuid(n, "b")
}

/** Camino de estados hasta el actual (el que siguió el envío en el prototipo). */
const PATH: Record<ShipmentStatusValue, ShipmentStatusValue[]> = {
  awaiting_receiver_confirmation: ["awaiting_receiver_confirmation"],
  rejected_by_receiver: [
    "awaiting_receiver_confirmation",
    "rejected_by_receiver",
  ],
  published: ["awaiting_receiver_confirmation", "published"],
  assignment_pending: [
    "awaiting_receiver_confirmation",
    "published",
    "assignment_pending",
  ],
  assigned_unfunded: [
    "awaiting_receiver_confirmation",
    "published",
    "assigned_unfunded",
  ],
  assigned: [
    "awaiting_receiver_confirmation",
    "published",
    "assignment_pending",
    "assigned",
  ],
  in_transit: [
    "awaiting_receiver_confirmation",
    "published",
    "assignment_pending",
    "assigned",
    "in_transit",
  ],
  delivered: [
    "awaiting_receiver_confirmation",
    "published",
    "assignment_pending",
    "assigned",
    "in_transit",
    "delivered",
  ],
  completed: [
    "awaiting_receiver_confirmation",
    "published",
    "assignment_pending",
    "assigned",
    "in_transit",
    "delivered",
    "completed",
  ],
  cancelled: ["awaiting_receiver_confirmation", "published", "cancelled"],
  disputed: [
    "awaiting_receiver_confirmation",
    "published",
    "assignment_pending",
    "assigned",
    "in_transit",
    "delivered",
    "disputed",
  ],
}

const OTHER_CARRIERS = [
  "Martina Gómez",
  "Juan Castro",
  "Sofía Paz",
  "Ana Torres",
  "Bruno Sosa",
]

/**
 * Ofertas del envío: con transportista, la aceptada (al precio acordado) y cuatro más que terminaron de
 * otra forma; publicado, tres abiertas; antes de publicarse, ninguna. Los montos usan las mismas cuentas
 * que `svc-shipments` (`decomposeOfferGrossPrice`/`estimateReceivedArs`).
 */
function offersFor(
  seed: Seed,
  carrier: { id: string; name: string } | null,
  acceptedId: string,
  acceptedAt: string | null,
  pickupDate: string
): AdminShipmentOffer[] {
  const make = (
    i: number,
    name: string,
    carrierId: string,
    priceArs: number,
    status: AdminShipmentOffer["status"],
    at: { created: number; responded: number | null; expires?: number }
  ): AdminShipmentOffer => {
    const { netArs, commissionAmountArs } = decomposeOfferGrossPrice(
      priceArs,
      DEFAULT_MOVO_COMMISSION_RATE
    )
    const otherDay = i === 1
    return {
      id: i === 0 ? acceptedId : uuid(seed.n * 10 + i, "e"),
      carrierId,
      carrierName: name,
      carrierRatingAtOffer: i === 3 ? null : 3.9 + ((seed.n + i * 7) % 11) / 10,
      status,
      priceArs,
      netArs,
      commissionArs: commissionAmountArs,
      commissionRate: DEFAULT_MOVO_COMMISSION_RATE,
      mpFeeEstimateArs: estimateMpFeeArs(priceArs),
      receivedEstimateArs: estimateReceivedArs(netArs, priceArs),
      offeredDate: otherDay ? dayOffset(seed.pickup[0] + 1) : pickupDate,
      pickupTimeWindowStart: otherDay ? "14:00" : i === 4 ? "10:00" : null,
      pickupTimeWindowEnd: otherDay ? "18:00" : i === 4 ? "11:30" : null,
      estimatedDeliveryDate: i === 2 ? null : pickupDate,
      estimatedDeliveryTimeWindowStart: i === 2 ? null : "16:00",
      estimatedDeliveryTimeWindowEnd: i === 2 ? null : "19:00",
      message:
        i === 0
          ? "Paso por la zona a la mañana, puedo retirarlo temprano."
          : i === 2
            ? "Si me confirman hoy lo llevo mañana."
            : null,
      tripId: null,
      createdAt: ago(at.created),
      viewedAtBySender: i === 2 || i === 4 ? null : ago(at.created - 15),
      respondedAt: at.responded === null ? null : ago(at.responded),
      expiresAt: at.expires === undefined ? null : ago(at.expires),
    }
  }
  const price = (factor: number) =>
    Math.round((seed.price * factor) / 100) * 100
  const others = (i: number) => personId(OTHER_CARRIERS[i - 1]!)

  if (!carrier || !acceptedAt) {
    if (seed.status !== "published") return []
    return [1, 2, 3].map((i) =>
      make(
        i,
        OTHER_CARRIERS[i - 1]!,
        others(i),
        price(0.9 + i * 0.07),
        "pending",
        {
          created: Math.max(1, seed.updated - i * 12),
          responded: null,
          expires: -(24 * 60),
        }
      )
    )
  }
  // `ago` cuenta minutos hacia atrás desde ahora; la aceptación es el punto de referencia.
  const t = Math.round((NOW - new Date(acceptedAt).getTime()) / 60_000)
  return [
    make(0, carrier.name, carrier.id, seed.price, "accepted", {
      created: t + 92,
      responded: t,
    }),
    make(1, OTHER_CARRIERS[0]!, others(1), price(0.96), "superseded", {
      created: t + 77,
      responded: t,
    }),
    make(2, OTHER_CARRIERS[1]!, others(2), price(1.08), "withdrawn", {
      created: t + 97,
      responded: t + 22,
    }),
    make(3, OTHER_CARRIERS[2]!, others(3), price(1.15), "rejected", {
      created: t + 120,
      responded: t + 37,
    }),
    make(4, OTHER_CARRIERS[3]!, others(4), price(1.04), "expired", {
      created: t + 132,
      responded: null,
      expires: t + 72,
    }),
  ]
}

export interface MockShipment {
  detail: AdminShipmentDetail
  events: AdminShipmentEvent[]
  offers: AdminShipmentOffer[]
  parties: AdminShipmentPartyCard[]
  payment: AdminShipmentPayment
  chat: Omit<AdminChatPage, "nextCursor" | "events">
}

function build(seed: Seed): MockShipment {
  const id = uuid(seed.n)
  const [pickupAddress, pickupCity, pickupLat, pickupLng] = PLACES[seed.from]!
  const [deliveryAddress, deliveryCity, deliveryLat, deliveryLng] =
    PLACES[seed.to]!
  const sender = { id: personId(seed.sender), name: seed.sender }
  const carrier = seed.carrier
    ? { id: personId(seed.carrier), name: seed.carrier }
    : null
  const receiver = { id: personId(seed.receiver), name: seed.receiver }
  const lastChange = ago(seed.updated)

  // Eventos espaciados hacia atrás desde el último cambio.
  const path = PATH[seed.status]
  const actorOf: Record<ShipmentStatusValue, string | null> = {
    awaiting_receiver_confirmation: sender.id,
    rejected_by_receiver: receiver.id,
    published: receiver.id,
    assignment_pending: sender.id,
    assigned_unfunded: sender.id,
    assigned: null,
    in_transit: carrier?.id ?? null,
    delivered: carrier?.id ?? null,
    completed: null,
    cancelled: sender.id,
    disputed: receiver.id,
  }
  // El mismo motivo que escribe `svc-shipments` al aceptar una oferta (MOVO-210).
  const acceptedId = uuid(seed.n * 10, "e")
  const acceptReason = (status: ShipmentStatusValue) =>
    status === "assignment_pending"
      ? `Oferta ${acceptedId} aceptada · ruta cercana: retiro en 1.7 días (dentro de 3); el emisor paga al aceptar`
      : `Oferta ${acceptedId} aceptada · ruta lejana: retiro en 4.2 días (a más de 3); el pago se confirma al abrirse la ventana`
  const events = path.map((status, i): AdminShipmentEvent => ({
    id: `${id.slice(0, 24)}${String(i).padStart(12, "0")}`,
    fromStatus: i === 0 ? null : path[i - 1]!,
    toStatus: status,
    actorId: actorOf[status],
    reason:
      i === path.length - 1 && seed.reason
        ? seed.reason
        : status === "assignment_pending" || status === "assigned_unfunded"
          ? acceptReason(status)
          : null,
    createdAt: ago(seed.updated + (path.length - 1 - i) * 95),
  }))

  const hasCarrier = carrier !== null
  // Con transportista, el sugerido queda arriba del acordado, como pasa en general.
  const suggestedPriceArs = hasCarrier
    ? Math.round((seed.price * 1.08) / 100) * 100
    : seed.price
  const offers = offersFor(
    seed,
    carrier,
    acceptedId,
    events.find(
      (e) =>
        e.toStatus === "assignment_pending" ||
        e.toStatus === "assigned_unfunded"
    )?.createdAt ?? null,
    dayOffset(seed.pickup[0])
  )
  const detail: AdminShipmentDetail = {
    id,
    code: id.slice(0, 8),
    status: seed.status,
    sender,
    carrier,
    receiver,
    pickupCity,
    pickupAddress,
    deliveryCity,
    deliveryAddress,
    pickupDate: dayOffset(seed.pickup[0]),
    pickupTimeWindowStart: seed.pickup[1],
    pickupTimeWindowEnd: seed.pickup[2],
    priceArs: seed.price,
    priceKind: hasCarrier ? "agreed" : "suggested",
    lastStatusChangeAt: lastChange,
    delayed: !!seed.delayed,
    disputeId: null,
    fundingDeadline: seed.status === "assigned_unfunded" ? ahead(5 * 60) : null,
    redesignationDeadline:
      seed.status === "rejected_by_receiver" ? ahead(20 * 60) : null,
    packageType: seed.pkg[0],
    weightKg: seed.pkg[1],
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: seed.pkg[2],
    urgent: false,
    // La oferta aceptada del mock deja el retiro como estaba, así que lo pedido coincide con lo acordado.
    requestedPickupDate: dayOffset(seed.pickup[0]),
    requestedPickupTimeWindowStart: seed.pickup[1],
    requestedPickupTimeWindowEnd: seed.pickup[2],
    pickupLat,
    pickupLng,
    deliveryLat,
    deliveryLng,
    suggestedPriceArs,
    agreedPriceArs: hasCarrier ? seed.price : null,
    paymentMethod: hasCarrier ? "card" : null,
    highDemand: false,
    estimatedDeliveryDate: null,
    deliveredAt: ["delivered", "completed", "disputed"].includes(seed.status)
      ? events.find((e) => e.toStatus === "delivered")!.createdAt
      : null,
    receiverConfirmationDeadline: null,
    transitAnomalyFlaggedAt: seed.delayed ? ago(40) : null,
    chatStartedAt: hasCarrier
      ? events[Math.min(2, events.length - 1)]!.createdAt
      : null,
    cancellationPenaltyArs: null,
    createdAt: events[0]!.createdAt,
  }

  const card = (
    person: { id: string; name: string },
    role: AdminShipmentPartyCard["role"]
  ): AdminShipmentPartyCard => {
    const h = [...person.name].reduce(
      (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
      7
    )
    return {
      id: person.id,
      role,
      fullName: person.name,
      photoUrl: null,
      accountStatus: "active",
      identityVerified: h % 5 !== 0,
      licenseVerified: role === "carrier",
      reputationScore: h % 9 === 0 ? null : 4.5 + (h % 6) / 10,
      ratingCount: h % 9 === 0 ? 0 : 4 + (h % 38),
    }
  }
  const parties = [
    card(sender, "sender"),
    ...(carrier ? [card(carrier, "carrier")] : []),
    card(receiver, "receiver"),
  ]

  const HOLD: Partial<Record<ShipmentStatusValue, "authorized" | "captured">> =
    {
      assigned: "authorized",
      in_transit: "authorized",
      delivered: "authorized",
      disputed: "authorized",
      completed: "captured",
    }
  const holdStatus = HOLD[seed.status]
  const payment: AdminShipmentPayment = holdStatus
    ? {
        id: uuid(seed.n, "c"),
        shipmentId: id,
        carrierId: carrier!.id,
        attempt: 1,
        mpPaymentId: String(1300000000 + seed.n),
        collectorId: "1234567",
        amountArs: seed.price,
        applicationFeeArs: Math.round(seed.price * 0.13),
        commissionArs: Math.round(seed.price * 0.13),
        baseAmountArs: seed.price,
        debtOffsetArs: 0,
        debtSurchargeArs: 0,
        carrierMpFeeArs: null,
        status: holdStatus,
        statusDetail:
          holdStatus === "captured" ? "accredited" : "pending_capture",
        failureReason: null,
        expiresAt: holdStatus === "authorized" ? ahead(4 * 1440) : null,
        createdAt: events.find((e) => e.toStatus === "assigned")!.createdAt,
        updatedAt: lastChange,
        wasAuthorized: true,
        cardBrand: "visa",
        cardLast4: "4242",
      }
    : null

  const chat = carrier ? chatFor(seed, sender, carrier, receiver, events) : null
  return {
    detail,
    events,
    offers,
    parties,
    payment,
    chat: chat ?? {
      items: [],
      partiesAccess: "closed",
      archived: false,
      reports: [],
    },
  }
}

function chatFor(
  seed: Seed,
  sender: { id: string; name: string },
  carrier: { id: string; name: string },
  receiver: { id: string; name: string },
  events: AdminShipmentEvent[]
): MockShipment["chat"] {
  const start = new Date(
    events[Math.min(2, events.length - 1)]!.createdAt
  ).getTime()
  const first = (n: string) => n.split(" ")[0]
  const lines: Array<
    [
      who: typeof sender,
      role: AdminChatMessage["authorRole"],
      body: string,
      moderated?: boolean,
    ]
  > = [
    [
      sender,
      "sender",
      `¡Hola ${first(carrier.name)}! El paquete está en portería, decile al encargado que vas de parte de ${first(sender.name)}.`,
    ],
    [carrier, "carrier", "Perfecto, paso entre 9 y 10."],
    [sender, "sender", "¡Gracias!"],
  ]
  if (
    ["in_transit", "delivered", "completed", "disputed"].includes(seed.status)
  )
    lines.push(
      [carrier, "carrier", "Ya lo tengo, salgo para allá."],
      [receiver, "receiver", "Genial, estoy en casa toda la mañana."],
      [receiver, "receiver", "El timbre no anda, llamame cuando llegues."],
      [
        carrier,
        "carrier",
        "Dale. Hay un corte en la avenida, voy por otra calle.",
      ]
    )
  if (seed.status === "disputed")
    lines.push(
      [
        receiver,
        "receiver",
        "Abrí la caja y la lámpara está partida al medio.",
      ],
      [
        carrier,
        "carrier",
        "La entregué tal cual me la dieron, la caja estaba sana.",
      ],
      [receiver, "receiver", "Sos un ********, se nota que la golpeaste.", true]
    )
  const span = Math.max(1, NOW - seed.updated * 60_000 - start)
  const items = lines.map(
    ([who, role, body, moderated], i): AdminChatMessage => ({
      id: `${uuid(seed.n, "d").slice(0, 24)}${String(i).padStart(12, "0")}`,
      authorId: who.id,
      authorName: who.name,
      authorRole: role,
      body,
      moderated: !!moderated,
      createdAt: new Date(
        start + 60_000 + (span * i) / lines.length
      ).toISOString(),
    })
  )
  const writable = [
    "assignment_pending",
    "assigned_unfunded",
    "assigned",
    "in_transit",
  ].includes(seed.status)
  return {
    items: items.reverse(),
    partiesAccess: writable
      ? "open"
      : seed.status === "completed"
        ? "closed"
        : "read_only",
    archived: seed.status === "completed",
    reports:
      seed.status === "disputed"
        ? [
            {
              reporterId: receiver.id,
              reporterRole: "receiver",
              createdAt: ago(seed.updated - 4),
            },
          ]
        : [],
  }
}

export const MOCK_SHIPMENTS: MockShipment[] = SEEDS.map(build)
