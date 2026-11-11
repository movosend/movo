import type {
  AdminReportId,
  DistanceBand,
} from "@movo/shared/src/types/admin-reports"

/**
 * Datos del modo fixtures de los reportes (`MOVO_ADMIN_MOCK=1`), portados del prototipo
 * `Movo Admin Reportes v2`. No son métricas reales: generan series creíbles y deterministas.
 */

/** Cómo genera cada métrica: valor base diario, tendencia a 90 días y si suma o promedia. */
export interface MockMetric {
  base: number
  trend: number
  agg: "sum" | "mean"
  pct?: true
  /** Multiplicador por tramo para las que promedian (las que suman se reparten por participación). */
  bandF?: [number, number, number]
}

const GEN_F: [number, number, number] = [0.93, 1.06, 1.3]
/** Porcentajes ("a tiempo", "completados"): bajan con la distancia, pero sin desplomarse. */
const RATE_F: [number, number, number] = [1.04, 0.97, 0.9]
const inv = (f: [number, number, number]): [number, number, number] => [
  1 / f[0],
  1 / f[1],
  1 / f[2],
]

export const MOCK_METRICS: Record<AdminReportId, Record<string, MockMetric>> = {
  cashflow: {
    gmv: { base: 84000, trend: 0.62, agg: "sum" },
    completed: { base: 7, trend: 0.32, agg: "sum" },
    commission: { base: 10070, trend: 0.42, agg: "sum" },
    takeRate: {
      base: 12,
      trend: 0.03,
      agg: "mean",
      pct: true,
      bandF: [1.04, 0.99, 0.93],
    },
    avgTicket: {
      base: 12000,
      trend: 0.08,
      agg: "mean",
      bandF: [0.62, 1.3, 2.4],
    },
  },
  /** `completed` y `avgTicket` salen de Cashflow (mismos números en las dos pestañas). */
  pricing: {
    completed: { base: 7, trend: 0.32, agg: "sum" },
    avgTicket: { base: 12000, trend: 0.08, agg: "mean" },
    priceIndex: { base: 101, trend: 0.04, agg: "mean" },
    captureRate: {
      base: 84,
      trend: 0.03,
      agg: "mean",
      pct: true,
      bandF: [1.03, 0.98, 0.92],
    },
  },
  deliveries: {
    onTimeRate: {
      base: 87,
      trend: 0.04,
      agg: "mean",
      pct: true,
      bandF: RATE_F,
    },
    doorToDoorHours: {
      base: 19,
      trend: -0.08,
      agg: "mean",
      bandF: [0.45, 1.1, 2.6],
    },
    incidentRate: {
      base: 3.4,
      trend: -0.1,
      agg: "mean",
      pct: true,
      bandF: GEN_F,
    },
    lateCount: { base: 0.8, trend: -0.05, agg: "sum" },
  },
  carriers: {
    assignedWithin24hRate: {
      base: 81,
      trend: 0.06,
      agg: "mean",
      pct: true,
      bandF: RATE_F,
    },
    timeToAssignHours: { base: 6.2, trend: -0.15, agg: "mean", bandF: GEN_F },
    activeCarriers: { base: 310, trend: 0.3, agg: "mean", bandF: inv(GEN_F) },
  },
  distances: {
    published: { base: 7, trend: 0.35, agg: "sum" },
    completionRate: {
      base: 91,
      trend: 0.03,
      agg: "mean",
      pct: true,
      bandF: RATE_F,
    },
    avgDistanceKm: {
      base: 236,
      trend: 0.05,
      agg: "mean",
      bandF: [0.48, 1.35, 3.1],
    },
  },
  support: {
    firstResponseMinutes: { base: 11, trend: -0.3, agg: "mean" },
    conversations: { base: 2.1, trend: 0.2, agg: "sum" },
    firstContactResolutionRate: {
      base: 61,
      trend: 0.1,
      agg: "mean",
      pct: true,
    },
  },
  disputes: {
    opened: { base: 0.35, trend: 0.15, agg: "sum" },
    resolved: { base: 0.33, trend: 0.2, agg: "sum" },
    resolutionHours: { base: 31, trend: -0.2, agg: "mean", bandF: GEN_F },
    disputeRate: {
      base: 1.5,
      trend: -0.1,
      agg: "mean",
      pct: true,
      bandF: GEN_F,
    },
  },
  /** `published` y `completed` salen de Distancias y Cashflow (mismos números en las pestañas). */
  operations: {
    published: { base: 7, trend: 0.35, agg: "sum" },
    completed: { base: 7, trend: 0.32, agg: "sum" },
    cancelled: { base: 0.9, trend: -0.1, agg: "sum" },
    demandRatio: { base: 1.6, trend: 0.12, agg: "mean" },
    highDemandRate: { base: 14, trend: 0.2, agg: "mean", pct: true },
    availableCarriers: { base: 4.2, trend: 0.25, agg: "mean" },
  },
  finance: {
    collected: { base: 79000, trend: 0.6, agg: "sum" },
    shipmentPrice: { base: 76500, trend: 0.6, agg: "sum" },
    commission: { base: 9900, trend: 0.42, agg: "sum" },
    mpFee: { base: 3800, trend: 0.55, agg: "sum" },
    carrierNet: { base: 65300, trend: 0.62, agg: "sum" },
    refunded: { base: 1100, trend: -0.1, agg: "sum" },
    debtGenerated: { base: 2600, trend: 0.3, agg: "sum" },
    debtCollected: { base: 2300, trend: 0.4, agg: "sum" },
    openDebt: { base: 48000, trend: 0.15, agg: "mean" },
  },
}

/** Participación base de cada valor de un desglose. */
export const MOCK_DIMENSIONS: Record<string, [string, number][]> = {
  band: [
    ["50_200", 52],
    ["200_500", 33],
    ["500_plus", 15],
  ],
  delayReason: [
    ["pickup_late", 34],
    ["in_route", 29],
    ["receiver_absent", 21],
    ["gps_anomaly", 16],
  ],
  topic: [
    ["shipment", 41],
    ["payments", 24],
    ["account", 16],
    ["carrier", 10],
    ["security", 9],
  ],
  reason: [
    ["damaged", 38],
    ["not_delivered", 17],
    ["transit_anomaly", 16],
    ["pickup_no_show", 13],
    ["wrong_delivery", 9],
    ["other", 7],
  ],
  outcome: [
    ["sender", 46],
    ["carrier", 31],
    ["partial", 23],
  ],
  cancelCause: [
    ["sender", 38],
    ["expired", 24],
    ["receiver", 14],
    ["pickup_missed_carrier", 10],
    ["pickup_missed_other", 6],
    ["admin", 4],
    ["dispute", 3],
    ["sanction", 1],
    ["other", 0],
  ],
  city: [
    ["Buenos Aires", 44],
    ["Córdoba", 17],
    ["Rosario", 14],
    ["Mendoza", 7],
    ["La Plata", 6],
    ["Tucumán", 5],
    ["Mar del Plata", 4],
    ["__unknown__", 3],
  ],
  kind: [
    ["delivery", 93],
    ["cancellation_penalty", 5],
    ["dispute_partial", 2],
  ],
  refundStatus: [
    ["succeeded", 82],
    ["fallback_to_ledger", 18],
  ],
  ledgerType: [
    ["cash_commission", 46],
    ["cancellation_penalty", 21],
    ["payment_surcharge", 18],
    ["manual_adjustment", 9],
    ["cancellation_compensation", 6],
  ],
}

export const MOCK_CITIES: Record<string, [number, number]> = {
  "Buenos Aires": [-34.6, -58.38],
  "La Plata": [-34.92, -57.95],
  Rosario: [-32.95, -60.65],
  "Santa Fe": [-31.63, -60.7],
  Córdoba: [-31.42, -64.18],
  Mendoza: [-32.89, -68.84],
  "San Luis": [-33.3, -66.34],
  "Mar del Plata": [-38.0, -57.55],
  "Bahía Blanca": [-38.72, -62.27],
  Neuquén: [-38.95, -68.06],
  Tucumán: [-26.82, -65.22],
  Salta: [-24.78, -65.41],
}

/** [origen, destino, km, peso relativo dentro del tramo, ajuste del completado]. */
export const MOCK_CORRIDORS: [string, string, number, number, number][] = [
  ["Buenos Aires", "La Plata", 60, 46, 4],
  ["Rosario", "Santa Fe", 170, 22, 2],
  ["Buenos Aires", "Rosario", 300, 40, 3],
  ["Buenos Aires", "Mar del Plata", 415, 22, 1],
  ["Rosario", "Córdoba", 400, 18, -1],
  ["Mendoza", "San Luis", 260, 8, -5],
  ["Tucumán", "Salta", 300, 9, -2],
  ["Buenos Aires", "Córdoba", 700, 30, 1],
  ["Córdoba", "Mendoza", 600, 14, -2],
  ["Buenos Aires", "Bahía Blanca", 640, 10, 0],
  ["Córdoba", "Tucumán", 560, 9, -6],
  ["Bahía Blanca", "Neuquén", 540, 6, -8],
  ["Buenos Aires", "Mendoza", 1050, 11, -3],
]

export const bandOfKm = (km: number): DistanceBand =>
  km < 200 ? "50_200" : km < 500 ? "200_500" : "500_plus"

// ---------------------------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------------------------

export const MOCK_ADMINS: [string, string][] = [
  ["3f6c1a52-8e0d-4b7a-9c21-5d4e8f1a2b90", "Tomás Ferreyra"],
  ["a81d4e07-2c9b-4f63-8a15-7e0b3c6d9f42", "Mariana Ríos"],
  ["5c2e9b10-7f4a-4d38-b6e1-0a9d2c8f7e53", "Lucía Paz"],
  ["e94b7c26-1d8f-4a05-9e3c-6b2f0d7a1c84", "Diego Arce"],
]

export const MOCK_USERS: [string, string][] = [
  ["b7e1c4d2-5a9f-4c31-9e2a-1f6d8c0a3b47", "Julián Ortiz"],
  ["c2a9f0e1-6b3d-4e8a-a1c7-9d5b2f4e8a10", "Carolina Sánchez"],
  ["d4f8a2b6-0c1e-4d97-b3a5-7e9c1f0d2b68", "Hernán Molina"],
  ["e6b0c3d9-2f4a-4b18-8c6e-1a7d3f9b5c02", "Agustina Vera"],
  ["f1d3e5a7-9b2c-4f60-a8d1-3c5e7b9f0a24", "Martín Quiroga"],
  ["a3c5e7f9-1b2d-4a86-9f03-5d7b9c1e3f46", "Sofía Bustos"],
]

export const MOCK_SHIPMENT_IDS = [
  "6a1f2c3d-4e5b-4a69-8b7c-0d1e2f348213",
  "7b2e3d4c-5f6a-4b70-9c8d-1e2f3a448176",
  "8c3f4e5d-6a7b-4c81-ad9e-2f3a4b548190",
  "9d4a5f6e-7b8c-4d92-be0f-3a4b5c648201",
]

/** [id de la disputa, envío, motivo]. */
export const MOCK_DISPUTE_TARGETS: [string, string, string][] = [
  ["0e1d2c3b-4a59-4687-9a6b-5c4d3e2f0142", MOCK_SHIPMENT_IDS[1], "damaged"],
  [
    "1f2e3d4c-5b6a-4798-8b7c-6d5e4f3a0139",
    MOCK_SHIPMENT_IDS[0],
    "not_delivered",
  ],
  [
    "2a3f4e5d-6c7b-48a9-9c8d-7e6f5a4b0137",
    MOCK_SHIPMENT_IDS[2],
    "transit_anomaly",
  ],
]

export const MOCK_SUPPORT_TARGETS: [string, string][] = [
  ["3b4a5f6e-7d8c-49ba-ad9e-8f7a6b5c1042", "SOP-1042"],
  ["4c5b6a7f-8e9d-4acb-be0f-9a8b7c6d1047", "SOP-1047"],
]

export const MOCK_REASONS: Record<string, string[]> = {
  "user.suspend": [
    "Tres reportes por trato inapropiado en una semana.",
    "No se presentó a dos retiros seguidos.",
  ],
  "user.disable": ["Intentó cobrar por fuera de la app; quedó en el chat."],
  "user.sanction_lift": ["Cumplió la suspensión y habló con soporte."],
  "user.sanction_withdraw": [
    "El primer retiro de actividad no llegó a cancelar sus ofertas.",
  ],
  "user.ledger_adjust": [
    "Compensación por un retiro fallido que no fue su culpa.",
    "Corrección de un crédito duplicado.",
  ],
  "user.contact_update": ["Lo pidió por soporte; verificado con DNI."],
  "user.sessions_revoke": ["Avisó que perdió el celular."],
  "user.note_add": [
    "Llamó dos veces por el mismo envío; pidió que lo contacten por mail.",
  ],
  "admin_role.grant": ["Se suma al equipo de soporte."],
  "admin_role.revoke": ["Dejó el equipo."],
  "shipment.status_change": [
    "El handshake de entrega falló dos veces; la receptora confirmó por teléfono.",
  ],
  "dispute.resolve": [
    "Las fotos muestran la caja sana al retiro y rota en la entrega. Se reparte el cobro.",
    "El GPS confirma la entrega en el domicilio. A favor del transportista.",
    "No hay handshake de entrega ni ubicación cerca del destino. Se reembolsa al emisor.",
  ],
  "dispute.note_add": ["Pedí al transportista la foto del retiro."],
}

export const MOCK_ERRORS: Record<string, string> = {
  "dispute.resolve": "DISPUTE_PAYMENT_FAILED",
  "user.suspend": "SANCTION_ALREADY_CLOSED",
  "admin_role.grant": "ADMIN_GRANT_EMAIL_NOT_VERIFIED",
  "user.ledger_adjust": "LEDGER_IDEMPOTENCY_CONFLICT",
}
