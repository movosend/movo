import type {
  CaptureLeakage,
  GmvBridge,
} from "@movo/shared/src/types/admin-reports"
import { BRIDGE_STEP, LEAKAGE_STEP } from "./catalog"
import { niceMax } from "./format"

/**
 * Barras de una cascada. `total` arranca en la base del eje; `up`/`down` flotan entre el nivel de
 * antes y el de después; `timing` resta como `down` pero no es pérdida (todavía puede capturarse).
 */
export interface WaterfallBar {
  key: string
  label: string
  kind: "total" | "up" | "down" | "timing"
  /** Con signo: lo que suma o resta (en un `total`, el total). */
  value: number
  /** Nivel antes y después del paso (en un `total`, 0 y el total). */
  from: number
  to: number
  desc?: string
  /** Envíos del paso, en la cascada de fugas. */
  shipments?: number
}

/** Un corchete sobre varias barras seguidas, con su suma ("Efecto precio"). */
export interface WaterfallGroup {
  first: number
  last: number
  label: string
  value: number
}

function walk(
  start: { key: string; label: string; value: number; desc?: string },
  steps: Omit<WaterfallBar, "from" | "to">[],
  end: { key: string; label: string; desc?: string }
): WaterfallBar[] {
  const bars: WaterfallBar[] = [
    { ...start, kind: "total", from: 0, to: start.value },
  ]
  let level = start.value
  for (const s of steps) {
    bars.push({ ...s, from: level, to: level + s.value })
    level += s.value
  }
  bars.push({ ...end, kind: "total", value: level, from: 0, to: level })
  return bars
}

const deltaKind = (v: number): "up" | "down" => (v >= 0 ? "up" : "down")

/** Puente del GMV: anterior → volumen → mix → componentes del precio → actual. */
export function bridgeBars(bridge: GmvBridge): {
  bars: WaterfallBar[]
  groups: WaterfallGroup[]
} {
  const price = bridge.price.filter((p) => p.amount !== 0)
  const bars = walk(
    { key: "previous", label: "Período anterior", value: bridge.previous },
    [
      {
        key: "volume",
        label: BRIDGE_STEP.volume.label,
        desc: BRIDGE_STEP.volume.desc,
        kind: deltaKind(bridge.volume),
        value: bridge.volume,
      },
      {
        key: "mix",
        label: BRIDGE_STEP.mix.label,
        desc: BRIDGE_STEP.mix.desc,
        kind: deltaKind(bridge.mix),
        value: bridge.mix,
      },
      ...price.map((p) => ({
        key: p.key,
        label: BRIDGE_STEP[p.key].label,
        desc: BRIDGE_STEP[p.key].desc,
        kind: deltaKind(p.amount),
        value: p.amount,
      })),
    ],
    { key: "current", label: "Este período" }
  )
  const groups: WaterfallGroup[] = price.length
    ? [
        {
          first: 3,
          last: 2 + price.length,
          label: "Efecto precio",
          value: price.reduce((a, p) => a + p.amount, 0),
        },
      ]
    : []
  return { bars, groups }
}

export type LeakageMode = "gmv" | "commission"

/** Fugas: cotizado → lo que se fue perdiendo (y lo que está en camino) → capturado. */
export function leakageBars(
  leakage: CaptureLeakage,
  mode: LeakageMode
): WaterfallBar[] {
  const amount = (a: { gmvArs: number; commissionArs: number }) =>
    mode === "gmv" ? a.gmvArs : a.commissionArs
  return walk(
    {
      key: "quoted",
      label: "Cotizado",
      value: amount(leakage.quoted),
      desc: `${leakage.quoted.shipments} envíos publicados en el período, a su precio cotizado.`,
    },
    leakage.steps
      .filter((s) => amount(s) !== 0)
      .map((s) => ({
        key: s.key,
        label: LEAKAGE_STEP[s.key].label,
        desc: LEAKAGE_STEP[s.key].desc,
        kind: s.timing ? "timing" : "down",
        value: -amount(s),
        shipments: s.shipments,
      })),
    { key: "captured", label: "Capturado" }
  )
}

/**
 * Rango del eje. Si los pasos son chicos al lado de los totales (un puente de GMV: ±2 % sobre
 * millones), arrancar en cero los deja invisibles: el eje se corta y la vista lo avisa.
 */
export function waterfallDomain(bars: WaterfallBar[]): {
  lo: number
  hi: number
  cut: boolean
} {
  const levels = bars.flatMap((b) =>
    b.kind === "total" ? [b.to] : [b.from, b.to]
  )
  const max = Math.max(0, ...levels)
  const min = Math.min(...levels)
  // Un nivel acumulado bajo cero (un puente o una cascada que se pasa de 0): el eje baja con él.
  if (min < 0)
    return {
      lo: -niceMax(-min * 1.05),
      hi: max > 0 ? niceMax(max * 1.05) : 0,
      cut: false,
    }
  if (!(max > 0)) return { lo: 0, hi: 1, cut: false }
  if (min <= max * 0.6) return { lo: 0, hi: niceMax(max * 1.05), cut: false }
  // Cuatro divisiones de un paso "lindo", así las etiquetas del eje no se repiten al abreviarlas.
  const floor = min - (max - min) * 0.6
  let step = niceMax((max - floor) / 4)
  let lo = Math.max(0, Math.floor(floor / step) * step)
  while (lo + 4 * step < max * 1.02) {
    step = niceMax(step * 1.001)
    lo = Math.max(0, Math.floor(floor / step) * step)
  }
  return { lo, hi: lo + 4 * step, cut: lo > 0 }
}
