import type {
  DisputeFunnelStage,
  DisputeFunnelStageKey,
  DisputesReport,
} from "@movo/shared/src/types/admin-reports"
import { deltaOf, formatMetric } from "@/lib/reports/format"
import { cn } from "@/lib/utils"
import { DeltaChip } from "./chart-bits"

const STAGE: Record<
  DisputeFunnelStageKey,
  { label: string; stuck: string; fill: string }
> = {
  opened: {
    label: "Abiertas",
    stuck: "",
    fill: "bg-foreground text-background",
  },
  decided: {
    label: "Decididas",
    stuck: "esperan la decisión de un admin",
    fill: "bg-[var(--viz-3)] text-[var(--viz-on-3)]",
  },
  resolved: {
    label: "Resueltas",
    stuck: "decididas, esperan que se mueva la plata",
    // La meta del embudo: en lima, con texto de tinta fija.
    fill: "bg-lime text-[#0a0a0b] ring-1 ring-[var(--lime-edge)] ring-inset",
  },
}

export interface FunnelStep extends DisputeFunnelStage {
  /** Sobre la etapa anterior y sobre las abiertas, en %. */
  fromPrevious: number | null
  fromStart: number | null
  /** Las que quedaron en la etapa anterior sin llegar a esta. */
  stuck: number
}

/** Conversión y "quedadas" de cada etapa. */
export function funnelSteps(stages: DisputeFunnelStage[]): FunnelStep[] {
  const start = stages[0]?.count ?? 0
  return stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1].count : null
    return {
      ...s,
      fromPrevious: prev ? (s.count / prev) * 100 : null,
      fromStart: start ? (s.count / start) * 100 : null,
      stuck: prev != null ? Math.max(prev - s.count, 0) : 0,
    }
  })
}

/**
 * Embudo de Disputas por cohorte: de las abiertas en el período, cuántas ya se decidieron y cuántas
 * terminaron de resolverse (con la plata movida). Entre etapas, la conversión, la mediana de tiempo y
 * cuántas quedaron trabadas ahí. Al costado, cuánto llegó al final contra la cohorte anterior.
 */
export function DisputesFlow({ report }: { report: DisputesReport }) {
  const head = (
    <div className="flex flex-col gap-1">
      <h2 className="text-[15px] font-semibold">De abiertas a resueltas</h2>
      <span className="text-[13px] text-pretty text-fg2">
        Las disputas abiertas en el período y hasta dónde llegaron. Una cohorte
        reciente todavía no terminó: es normal que se achique hacia abajo.
      </span>
    </div>
  )
  if (!report.funnel?.length)
    return (
      <section className="flex flex-col gap-4 rounded-[10px] border bg-card p-[18px]">
        {head}
        <p className="rounded-lg bg-muted px-4 py-6 text-center text-sm text-fg2">
          No se abrió ninguna disputa en este rango.
        </p>
      </section>
    )
  const steps = funnelSteps(report.funnel)
  const top = Math.max(steps[0].count, 1)
  const widths = steps.map((s) => Math.max((s.count / top) * 100, 12))
  const last = steps[steps.length - 1]
  const lastPrev =
    steps[0].previous && last.previous != null
      ? (last.previous / steps[0].previous) * 100
      : null
  return (
    <section className="flex flex-col gap-4 rounded-[10px] border bg-card p-[18px]">
      {head}
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_250px]">
        <ol
          aria-label={steps
            .map((s) => `${STAGE[s.key].label}: ${s.count}`)
            .join(", ")}
          className="flex flex-col"
        >
          {steps.map((s, i) => {
            const a = (100 - (widths[i - 1] ?? 0)) / 2
            const b = (100 - widths[i]) / 2
            return (
              <li key={s.key} className="flex flex-col">
                {i > 0 && (
                  <div className="relative h-11">
                    <div
                      aria-hidden
                      className="absolute inset-0 bg-muted"
                      style={{
                        clipPath: `polygon(${a}% 0, ${100 - a}% 0, ${100 - b}% 100%, ${b}% 100%)`,
                      }}
                    />
                    <div className="relative flex h-full items-center justify-center gap-2 text-xs">
                      <span className="font-semibold tabular-nums">
                        {formatMetric("pct", s.fromPrevious)}
                      </span>
                      {s.medianHoursFromPrevious != null && (
                        <span className="text-fg2">
                          en {formatMetric("h", s.medianHoursFromPrevious)}{" "}
                          (mediana)
                        </span>
                      )}
                      {s.stuck > 0 && (
                        <span className="rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn-fg">
                          {s.stuck} {STAGE[s.key].stuck}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex justify-center">
                  <div
                    style={{ width: `${widths[i]}%` }}
                    className={cn(
                      "flex h-11 items-center justify-between gap-3 rounded-[6px] px-3.5",
                      STAGE[s.key].fill
                    )}
                  >
                    <span className="truncate text-[13px] font-medium">
                      {STAGE[s.key].label}
                    </span>
                    <span className="text-lg font-semibold tabular-nums">
                      {formatMetric("n", s.count)}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
        <dl className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-fg2">Llegaron a resueltas</dt>
            <dd className="flex items-center gap-2">
              <span className="text-[26px] leading-none font-semibold tabular-nums">
                {formatMetric("pct", last.fromStart)}
              </span>
              <DeltaChip
                delta={deltaOf("pct", "up", last.fromStart, lastPrev)}
              />
            </dd>
            <dd className="text-xs text-muted-foreground">
              Cohorte anterior {formatMetric("pct", lastPrev)}
            </dd>
          </div>
          {steps.slice(1).map((s) => (
            <div key={s.key} className="flex items-baseline gap-2 text-[13px]">
              <dt className="flex-1 text-fg2">{STAGE[s.key].label}, antes</dt>
              <dd className="tabular-nums">
                {formatMetric("n", s.previous)}{" "}
                <span className="text-muted-foreground">
                  → {formatMetric("n", s.count)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
