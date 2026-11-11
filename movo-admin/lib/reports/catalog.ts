import {
  OPERATIONS_OTHER_CITIES,
  OPERATIONS_UNKNOWN_CITY,
  type AdminReportId,
  type CancellationCause,
  type CaptureLeakageStep,
  type DeliveryDelayReason,
  type DistanceBand,
  type PriceComponent,
  type ReportCorridor,
  type ReportScorecardMetric,
} from "@movo/shared/src/types/admin-reports"
import { DisputeReason } from "@movo/shared/src/types/dispute"
import { DISPUTE_REASON_LABEL } from "@/lib/disputes/format"
import { TOPIC_LABEL } from "@/lib/support/labels"
import { LEDGER_TYPE } from "@/lib/users/format"
import { BAND_LABEL, type MetricUnit } from "./format"

/**
 * Qué muestra cada pestaña de Métricas (prototipo `Movo Admin Reportes v2`, MOVO-345). Los números
 * los calcula el backend (MOVO-344); acá solo vive cómo se presentan: etiqueta, unidad, si "más" es
 * bueno, la descripción del gráfico y qué desgloses se dibujan.
 */
export interface MetricMeta {
  label: string
  unit: MetricUnit
  good: "up" | "down"
  desc: string
  /** Suma (envíos, plata) en vez de promediar: el desglose muestra la participación de cada fila. */
  sums: boolean
  /** Meta del panel (no la manda el backend): línea en la tendencia y referencia en la tarjeta. */
  target?: number
}

/**
 * Meta de entregas a tiempo. Provisoria: la fija el equipo (MOVO-345); cambiarla acá alcanza, la usan la
 * tarjeta y la tendencia de Entregas.
 */
export const ON_TIME_TARGET = 90

export interface BreakdownPanel {
  dimension: string
  metric: string
  title: string
  /** Métrica de apoyo de cada fila (`row.extra[key]`). */
  extra?: { key: string; label: string }
}

export interface ReportTab {
  id: AdminReportId
  label: string
  /** Nombre del ícono de lucide (se resuelve en `components/reports/metrics/tab-icon.tsx`). */
  icon:
    | "Wallet"
    | "Tag"
    | "PackageCheck"
    | "Truck"
    | "Route"
    | "Headset"
    | "Scale"
    | "Activity"
    | "Landmark"
  question: string
  kpis: string[]
  /**
   * Tarjetas como una cuenta: `ops[i]` va entre la tarjeta i y la i+1 ("=", "×"). Sin esto, una fila
   * con `kpis`.
   */
  kpiRows?: { keys: string[]; ops?: string[] }[]
  breakdowns: BreakdownPanel[]
  /** Distancias: mapa de corredores y comparación de los tres tramos. */
  scorecard?: true
  /** Precio y volumen: puente del GMV y cascada de fugas de captura. */
  waterfalls?: true
  /** Disputas: embudo de abiertas a resueltas. */
  flow?: true
  /** Transportistas: publicados contra asignados en 24 h, en el tiempo. */
  supply?: true
  /** Operación: selector de la ciudad del retiro (MOVO-35). */
  city?: true
  /** Finanzas: pendientes de Mercado Pago, saldo de la cuenta corriente y CSV de liquidaciones. */
  finance?: true
}

export const METRICS: Record<AdminReportId, Record<string, MetricMeta>> = {
  cashflow: {
    gmv: {
      label: "GMV",
      unit: "ars",
      good: "up",
      sums: true,
      desc: "Plata cobrada por envíos completados, antes de comisiones.",
    },
    completed: {
      label: "Envíos completados",
      unit: "n",
      good: "up",
      sums: true,
      desc: "Envíos que llegaron a completados: el volumen detrás del GMV.",
    },
    commission: {
      label: "Comisión Movo",
      unit: "ars",
      good: "up",
      sums: true,
      desc: "Comisión de Movo sobre los envíos completados.",
    },
    takeRate: {
      label: "Take rate",
      unit: "pct",
      good: "up",
      sums: false,
      desc: "Comisión sobre GMV.",
    },
    avgTicket: {
      label: "Ticket promedio",
      unit: "ars",
      good: "up",
      sums: false,
      desc: "Precio promedio de un envío completado.",
    },
  },
  pricing: {
    completed: {
      label: "Envíos completados",
      unit: "n",
      good: "up",
      sums: true,
      desc: "Envíos que llegaron a completados.",
    },
    avgTicket: {
      label: "Ticket promedio",
      unit: "ars",
      good: "up",
      sums: false,
      desc: "GMV sobre envíos completados. Se mueve por precio y por mix de distancias.",
    },
    priceIndex: {
      label: "Índice de precio",
      unit: "idx",
      good: "up",
      sums: false,
      desc: "Precio a mix de distancias constante; 100 es el período anterior.",
    },
    captureRate: {
      label: "Capturado",
      unit: "pct",
      good: "up",
      sums: false,
      desc: "GMV capturado sobre el cotizado de lo publicado en el período.",
    },
  },
  deliveries: {
    onTimeRate: {
      label: "Entregados a tiempo",
      unit: "pct",
      good: "up",
      sums: false,
      desc: "Entregados dentro de la ventana que vio el emisor al publicar.",
      target: ON_TIME_TARGET,
    },
    doorToDoorHours: {
      label: "Puerta a puerta",
      unit: "h",
      good: "down",
      sums: false,
      desc: "Mediana entre el retiro y la entrega.",
    },
    incidentRate: {
      label: "Con incidencia",
      unit: "pct",
      good: "down",
      sums: false,
      desc: "Envíos con disputa, daño reportado o anomalía en el viaje.",
    },
    lateCount: {
      label: "Entregas tarde",
      unit: "n",
      good: "down",
      sums: true,
      desc: "Envíos entregados fuera de la ventana.",
    },
  },
  carriers: {
    assignedWithin24hRate: {
      label: "Asignados en 24 h",
      unit: "pct",
      good: "up",
      sums: false,
      desc: "Envíos que consiguieron transportista dentro de las 24 h de publicados.",
    },
    timeToAssignHours: {
      label: "Tiempo hasta asignación",
      unit: "h",
      good: "down",
      sums: false,
      desc: "Mediana entre la publicación y la elección del transportista.",
    },
    activeCarriers: {
      label: "Transportistas activos",
      unit: "n",
      good: "up",
      sums: false,
      desc: "Promedio diario con al menos un viaje ofrecido o hecho.",
    },
  },
  distances: {
    published: {
      label: "Envíos publicados",
      unit: "n",
      good: "up",
      sums: true,
      desc: "Envíos publicados en la red.",
    },
    completionRate: {
      label: "Completados",
      unit: "pct",
      good: "up",
      sums: false,
      desc: "Completados sobre publicados.",
    },
    avgDistanceKm: {
      label: "Distancia media",
      unit: "km",
      good: "up",
      sums: false,
      desc: "Kilómetros promedio entre origen y destino.",
    },
  },
  support: {
    firstResponseMinutes: {
      label: "Primera respuesta",
      unit: "min",
      good: "down",
      sums: false,
      desc: "Mediana hasta el primer mensaje de un admin.",
    },
    conversations: {
      label: "Conversaciones",
      unit: "n",
      good: "down",
      sums: true,
      desc: "Conversaciones de soporte abiertas.",
    },
    firstContactResolutionRate: {
      label: "Resueltas al primer contacto",
      unit: "pct",
      good: "up",
      sums: false,
      desc: "Cerradas sin que el usuario vuelva a escribir.",
    },
  },
  disputes: {
    opened: {
      label: "Disputas abiertas",
      unit: "n",
      good: "down",
      sums: true,
      desc: "Disputas nuevas, por fecha de apertura.",
    },
    resolved: {
      label: "Disputas resueltas",
      unit: "n",
      good: "up",
      sums: true,
      desc: "Disputas que llegaron a resueltas. Las que esperan el pago no cuentan.",
    },
    resolutionHours: {
      label: "Tiempo de resolución",
      unit: "h",
      good: "down",
      sums: false,
      desc: "Mediana entre la apertura y la resolución.",
    },
    disputeRate: {
      label: "Tasa de disputa",
      unit: "pct",
      good: "down",
      sums: false,
      desc: "Disputas abiertas sobre envíos completados.",
    },
  },
  operations: {
    published: {
      label: "Publicados",
      unit: "n",
      good: "up",
      sums: true,
      desc: "Envíos que se publicaron por primera vez en el período.",
    },
    completed: {
      label: "Completados",
      unit: "n",
      good: "up",
      sums: true,
      desc: "Envíos que llegaron a completados por primera vez.",
    },
    cancelled: {
      label: "Cancelados",
      unit: "n",
      good: "down",
      sums: true,
      desc: "Envíos cancelados, por la fecha de la cancelación.",
    },
    demandRatio: {
      label: "Envíos por transportista",
      unit: "ratio",
      good: "down",
      sums: false,
      desc: "Lo que vio el precio al publicar cada envío: envíos esperando en la zona de retiro por cada transportista que pasa cerca. Arriba del umbral se cobra recargo.",
    },
    highDemandRate: {
      label: "Con recargo por demanda",
      unit: "pct",
      good: "down",
      sums: false,
      desc: "Envíos publicados que se cotizaron con recargo por alta demanda.",
    },
    availableCarriers: {
      label: "Transportistas cerca",
      unit: "n",
      good: "up",
      sums: false,
      desc: "Promedio de transportistas con viaje por la zona de retiro al publicar. Solo los envíos creados desde que se guarda este dato.",
    },
  },
  finance: {
    collected: {
      label: "Cobrado",
      unit: "ars",
      good: "up",
      sums: true,
      desc: "Lo que pagaron los emisores en las capturas que Mercado Pago confirmó, con el recargo por deuda.",
    },
    shipmentPrice: {
      label: "Precio de los envíos",
      unit: "ars",
      good: "up",
      sums: true,
      desc: "Lo cobrado sin el recargo por deuda del emisor.",
    },
    commission: {
      label: "Comisión Movo",
      unit: "ars",
      good: "up",
      sums: true,
      desc: "Comisión de Movo en las capturas confirmadas.",
    },
    mpFee: {
      label: "Fee de Mercado Pago",
      unit: "ars",
      good: "down",
      sums: true,
      desc: "Lo que descontó Mercado Pago, según su confirmación de cada captura.",
    },
    carrierNet: {
      label: "Neto a transportistas",
      unit: "ars",
      good: "up",
      sums: true,
      desc: "Lo que les quedó a los transportistas después de la comisión y el fee.",
    },
    refunded: {
      label: "Reembolsado",
      unit: "ars",
      good: "down",
      sums: true,
      desc: "Reembolsos terminados, a Mercado Pago o a la cuenta corriente.",
    },
    debtGenerated: {
      label: "Deuda generada",
      unit: "ars",
      good: "down",
      sums: true,
      desc: "Movimientos de deuda nuevos en la cuenta corriente.",
    },
    debtCollected: {
      label: "Deuda cobrada",
      unit: "ars",
      good: "up",
      sums: true,
      desc: "Pagos y descuentos que bajaron la deuda de la cuenta corriente.",
    },
    openDebt: {
      label: "Deuda abierta",
      unit: "ars",
      good: "down",
      sums: false,
      desc: "Lo que deben los usuarios con saldo deudor, al cierre de cada período.",
    },
  },
}

export const REPORT_TABS: ReportTab[] = [
  {
    id: "cashflow",
    label: "Cashflow",
    icon: "Wallet",
    question: "Cuánta plata mueve la red y cuánto queda para Movo.",
    kpis: ["gmv", "completed", "avgTicket", "commission", "takeRate"],
    kpiRows: [
      { keys: ["gmv", "completed", "avgTicket"], ops: ["=", "×"] },
      { keys: ["commission", "takeRate"] },
    ],
    breakdowns: [
      {
        dimension: "band",
        metric: "gmv",
        title: "GMV por distancia",
        extra: { key: "avgTicket", label: "Ticket promedio" },
      },
    ],
  },
  {
    id: "pricing",
    label: "Precio y volumen",
    icon: "Tag",
    question:
      "Si el GMV crece por más envíos o por precio, y dónde se pierde lo cotizado.",
    kpis: ["completed", "avgTicket", "priceIndex", "captureRate"],
    breakdowns: [
      {
        dimension: "band",
        metric: "completed",
        title: "Envíos completados por distancia",
        extra: { key: "avgTicket", label: "Ticket promedio" },
      },
    ],
    waterfalls: true,
  },
  {
    id: "deliveries",
    label: "Entregas",
    icon: "PackageCheck",
    question: "Si los paquetes llegan bien y a tiempo.",
    kpis: ["onTimeRate", "doorToDoorHours", "incidentRate"],
    breakdowns: [
      {
        dimension: "delayReason",
        metric: "lateCount",
        title: "Por qué llegan tarde",
      },
    ],
  },
  {
    id: "carriers",
    label: "Transportistas",
    icon: "Truck",
    question: "Si hay gente suficiente para llevar lo que se publica.",
    kpis: ["assignedWithin24hRate", "timeToAssignHours", "activeCarriers"],
    breakdowns: [
      {
        dimension: "band",
        metric: "assignedWithin24hRate",
        title: "Asignados en 24 h, por distancia",
        extra: { key: "timeToAssignHours", label: "Asignación" },
      },
    ],
    supply: true,
  },
  {
    id: "distances",
    label: "Distancias",
    icon: "Route",
    question: "Qué tramos funcionan y cuáles no.",
    kpis: ["published", "completionRate", "avgDistanceKm"],
    breakdowns: [],
    scorecard: true,
  },
  {
    id: "support",
    label: "Soporte",
    icon: "Headset",
    question: "Si soporte da abasto.",
    kpis: [
      "firstResponseMinutes",
      "conversations",
      "firstContactResolutionRate",
    ],
    breakdowns: [
      {
        dimension: "topic",
        metric: "conversations",
        title: "Conversaciones por tema",
      },
    ],
  },
  {
    id: "disputes",
    label: "Disputas",
    icon: "Scale",
    question: "Por qué se abren disputas y cómo se resuelven.",
    kpis: ["opened", "resolutionHours", "disputeRate"],
    breakdowns: [
      { dimension: "reason", metric: "opened", title: "Por motivo" },
      { dimension: "outcome", metric: "resolved", title: "Por resultado" },
    ],
    flow: true,
  },
  {
    id: "operations",
    label: "Operación",
    icon: "Activity",
    question:
      "Cuánto se publica, se completa y se cancela, y dónde falta gente para llevarlo.",
    kpis: [
      "published",
      "completed",
      "cancelled",
      "demandRatio",
      "highDemandRate",
      "availableCarriers",
    ],
    kpiRows: [
      { keys: ["published", "completed", "cancelled"] },
      { keys: ["demandRatio", "highDemandRate", "availableCarriers"] },
    ],
    breakdowns: [
      {
        dimension: "cancelCause",
        metric: "cancelled",
        title: "Por qué se cancelan",
      },
      {
        dimension: "city",
        metric: "published",
        title: "Publicados por ciudad de retiro",
        extra: { key: "demandRatio", label: "Envíos por transportista" },
      },
    ],
    city: true,
  },
  {
    id: "finance",
    label: "Finanzas",
    icon: "Landmark",
    question:
      "Cuánto entró, cuánto se llevó Mercado Pago, cuánto quedó y cuánta deuda sigue abierta.",
    kpis: [
      "collected",
      "shipmentPrice",
      "commission",
      "mpFee",
      "carrierNet",
      "refunded",
      "debtGenerated",
      "debtCollected",
      "openDebt",
    ],
    kpiRows: [
      { keys: ["collected", "shipmentPrice", "refunded"] },
      { keys: ["commission", "mpFee", "carrierNet"] },
      { keys: ["debtGenerated", "debtCollected", "openDebt"] },
    ],
    breakdowns: [
      { dimension: "kind", metric: "collected", title: "Cobrado por tipo" },
      {
        dimension: "refundStatus",
        metric: "refunded",
        title: "Reembolsos por destino",
      },
      {
        dimension: "ledgerType",
        metric: "debtGenerated",
        title: "Deuda generada por tipo",
      },
    ],
    finance: true,
  },
]

export const DEFAULT_TAB: AdminReportId = "cashflow"

export const tabOf = (id: AdminReportId): ReportTab =>
  REPORT_TABS.find((t) => t.id === id) ?? REPORT_TABS[0]

/** La métrica de una pestaña, o la de un desglose que no es KPI (p. ej. `lateCount`, `resolved`). */
export function metricOf(report: AdminReportId, key: string): MetricMeta {
  return (
    METRICS[report][key] ?? {
      label: key,
      unit: "n",
      good: "up",
      sums: true,
      desc: "",
    }
  )
}

export const DIMENSION_LABEL: Record<string, string> = {
  band: "Distancia",
  delayReason: "Motivo de la demora",
  topic: "Tema",
  reason: "Motivo",
  outcome: "Resultado",
  cancelCause: "Causa",
  city: "Ciudad de retiro",
  kind: "Tipo de captura",
  refundStatus: "Destino del reembolso",
  ledgerType: "Tipo de movimiento",
}

/** Por qué se canceló un envío (DD-059). */
export const CANCEL_CAUSE_LABEL: Record<CancellationCause, string> = {
  sender: "Lo canceló el emisor",
  receiver: "El receptor no confirmó",
  expired: "Nadie lo tomó a tiempo",
  pickup_missed_carrier: "El transportista no retiró",
  pickup_missed_other: "Retiro no realizado",
  sanction: "Cuenta suspendida",
  dispute: "Disputa a favor del emisor",
  admin: "Desde el panel",
  other: "Otro",
}

/** Claves reservadas del desglose por ciudad; el resto son nombres de ciudad y se muestran tal cual. */
export const CITY_KEY_LABEL: Record<string, string> = {
  [OPERATIONS_UNKNOWN_CITY]: "Sin ciudad",
  [OPERATIONS_OTHER_CITIES]: "Otras ciudades",
}

export const SETTLEMENT_KIND_LABEL: Record<string, string> = {
  delivery: "Entregas",
  cancellation_penalty: "Penalidades por cancelación",
  dispute_partial: "Disputas parciales",
}

export const REFUND_STATUS_LABEL: Record<string, string> = {
  succeeded: "A Mercado Pago",
  fallback_to_ledger: "A la cuenta corriente",
}

export const DELAY_REASON_LABEL: Record<DeliveryDelayReason, string> = {
  pickup_late: "Retiro fuera de horario",
  in_route: "Demora en ruta",
  receiver_absent: "Receptor ausente",
  gps_anomaly: "Anomalía de GPS",
}

export const OUTCOME_LABEL: Record<string, string> = {
  sender: "A favor del emisor",
  carrier: "A favor del transportista",
  partial: "Parcial",
}

const KEY_LABELS: Record<string, Record<string, string>> = {
  band: BAND_LABEL,
  delayReason: DELAY_REASON_LABEL,
  topic: TOPIC_LABEL,
  reason: DISPUTE_REASON_LABEL,
  outcome: OUTCOME_LABEL,
  cancelCause: CANCEL_CAUSE_LABEL,
  city: CITY_KEY_LABEL,
  kind: SETTLEMENT_KIND_LABEL,
  refundStatus: REFUND_STATUS_LABEL,
  ledgerType: LEDGER_TYPE,
}

/** Claves conocidas de una dimensión, en orden fijo (el color de cada una sale de acá). */
export const dimensionKeys = (dimension: string): string[] =>
  Object.keys(KEY_LABELS[dimension] ?? {})

/** Etiqueta de una fila de desglose; si el backend manda una clave nueva, se muestra tal cual. */
export const dimensionKeyLabel = (dimension: string, key: string): string =>
  KEY_LABELS[dimension]?.[key] ?? key

export const isDisputeReason = (value: string): value is DisputeReason =>
  (Object.values(DisputeReason) as string[]).includes(value)

/** Columnas de "Cómo rinde cada distancia", en el orden del prototipo. */
export const SCORECARD_COLUMNS: {
  key: ReportScorecardMetric
  label: string
  unit: MetricUnit
  good: "up" | "down"
  sums: boolean
}[] = [
  {
    key: "published",
    label: "Envíos publicados",
    unit: "n",
    good: "up",
    sums: true,
  },
  {
    key: "completionRate",
    label: "Completados",
    unit: "pct",
    good: "up",
    sums: false,
  },
  {
    key: "onTimeRate",
    label: "Entregados a tiempo",
    unit: "pct",
    good: "up",
    sums: false,
  },
  {
    key: "assignedWithin24hRate",
    label: "Asignados en 24 h",
    unit: "pct",
    good: "up",
    sums: false,
  },
  {
    key: "doorToDoorHours",
    label: "Puerta a puerta",
    unit: "h",
    good: "down",
    sums: false,
  },
  {
    key: "avgTicket",
    label: "Ticket promedio",
    unit: "ars",
    good: "up",
    sums: false,
  },
]

/** Un corredor con completado por debajo de esto va en ámbar en el mapa y en la tabla. */
export const CORRIDOR_LOW_COMPLETION = 88

/** Clave de un corredor (mapa y tabla se resaltan juntos con esto). */
export const corridorKey = (c: ReportCorridor) =>
  `${c.originCity}→${c.destinationCity}`

export const bandLabelOf = (band: DistanceBand | null) =>
  band ? BAND_LABEL[band] : "todas las distancias"

/** Pasos del puente del GMV (Precio y volumen). */
export const BRIDGE_STEP: Record<
  "volume" | "mix" | PriceComponent,
  { label: string; desc: string }
> = {
  volume: {
    label: "Volumen",
    desc: "Más o menos envíos completados, valuados al ticket del período anterior.",
  },
  mix: {
    label: "Mix de distancias",
    desc: "Cambió el reparto entre tramos: más envíos largos suben el ticket sin que suba el precio.",
  },
  fuel: {
    label: "Combustible",
    desc: "Precio del combustible con el que se cotizó.",
  },
  demand: {
    label: "Demanda",
    desc: "Recargo por alta demanda en la zona de retiro.",
  },
  distance: {
    label: "Km en el tramo",
    desc: "Kilómetros dentro del mismo tramo de distancia.",
  },
  package: {
    label: "Bulto",
    desc: "Peso facturable y recargo por frágil.",
  },
  algorithm: {
    label: "Algoritmo",
    desc: "Cambio de versión de la fórmula de precio.",
  },
  negotiation: {
    label: "Negociación",
    desc: "Precio acordado contra el sugerido, por las ofertas de los transportistas.",
  },
  other: {
    label: "Otros",
    desc: "Lo que no se atribuye a un componente (redondeos, ajustes).",
  },
}

/** Pasos de la cascada de fugas de captura. */
export const LEAKAGE_STEP: Record<
  CaptureLeakageStep,
  { label: string; desc: string }
> = {
  unassigned: {
    label: "Sin transportista",
    desc: "Venció sin que nadie lo tomara.",
  },
  cancelled: {
    label: "Cancelados",
    desc: "Cancelados por el emisor o el transportista antes del retiro.",
  },
  payment_failed: {
    label: "Pago no autorizado",
    desc: "El pago no se autorizó o el envío venció sin fondearse.",
  },
  hold_expired: {
    label: "Hold vencido",
    desc: "La reserva de Mercado Pago venció antes de capturarse.",
  },
  capture_failed: {
    label: "Captura fallida",
    desc: "Mercado Pago rechazó la captura o quedó escalada.",
  },
  dispute_refund: {
    label: "Reembolsos",
    desc: "Devuelto total o parcialmente al resolver una disputa.",
  },
  cash_commission_debt: {
    label: "Comisión en efectivo",
    desc: "Envíos en efectivo cuya comisión el transportista todavía debe.",
  },
  pending_capture: {
    label: "Por confirmar",
    desc: "Entregados; la captura espera la confirmación de Mercado Pago.",
  },
  in_flight: {
    label: "En curso",
    desc: "Asignados o en viaje: todavía no se entregaron.",
  },
}
