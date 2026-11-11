"use client"
import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Activity,
  Headset,
  Landmark,
  LinkIcon,
  PackageCheck,
  Route,
  Scale,
  Tag,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import {
  DISTANCE_BANDS,
  type ReportRange,
} from "@movo/shared/src/types/admin-reports"
import { REPORT_TABS, type ReportTab } from "@/lib/reports/catalog"
import { BAND_LABEL, monthName, rangeLabel } from "@/lib/reports/format"
import { metricsHref, type MetricsState } from "@/lib/reports/params"
import { previousRange, type RangePreset } from "@/lib/reports/range"
import { cn } from "@/lib/utils"
import { useToast } from "../toasts"

const TAB_ICON: Record<ReportTab["icon"], LucideIcon> = {
  Wallet,
  Tag,
  PackageCheck,
  Truck,
  Route,
  Headset,
  Scale,
  Activity,
  Landmark,
}

function Segmented<T extends string | null>({
  label,
  options,
  value,
  onPick,
  disabled,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onPick: (v: T) => void
  disabled?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap rounded-lg bg-muted p-[3px]"
        title={disabled}
      >
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.label}
              type="button"
              aria-pressed={on}
              disabled={!!disabled}
              onClick={() => onPick(o.value)}
              className={cn(
                "h-7 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50",
                on
                  ? "bg-card text-foreground shadow-[var(--shadow-1)]"
                  : "text-fg2 hover:text-foreground"
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Rango, distancia y pestañas de Métricas. Todo vive en la URL (`/metrics?tab=&r=&d=&desde=&hasta=`):
 * "Copiar link" comparte la misma vista y cada cambio vuelve a pedir el reporte al servidor.
 */
export function MetricsToolbar({
  state,
  range,
  today,
  bandApplied,
}: {
  state: MetricsState
  range: ReportRange
  today: string
  bandApplied: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  const go = (patch: Partial<MetricsState>) =>
    start(() =>
      router.push(metricsHref({ ...state, ...patch }), { scroll: false })
    )
  const prevMonth = new Date(`${today}T12:00:00Z`)
  prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1, 1)
  const presets: { value: RangePreset; label: string }[] = [
    { value: "7d", label: "7 días" },
    { value: "30d", label: "30 días" },
    { value: "90d", label: "90 días" },
    { value: "prev", label: monthName(prevMonth.getUTCMonth()) },
    { value: "custom", label: "Personalizado" },
  ]
  const pickPreset = (preset: RangePreset) =>
    preset === "custom"
      ? go({ preset, from: state.from ?? range.from, to: state.to ?? range.to })
      : go({ preset, from: null, to: null })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast({
        title: "Link copiado",
        sub: "Abre esta pestaña con el mismo rango y distancia.",
      })
    } catch {
      toast({
        tone: "danger",
        title: "No pudimos copiar el link",
        sub: "Copialo desde la barra de direcciones.",
      })
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[620px] flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Métricas
          </h1>
          <p className="text-sm text-pretty text-fg2">
            Cómo viene la red. Elegí el rango y la distancia: todo lo de abajo
            se ajusta, y cada CSV trae lo mismo que ves.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Para mostrar el panel con una red chica (la demo en vivo): solo cambia Métricas, con aviso. */}
          <Segmented
            label="Datos"
            options={[
              { value: "real", label: "Reales" },
              { value: "demo", label: "Demo" },
            ]}
            value={state.demo ? "demo" : "real"}
            onPick={(v) => go({ demo: v === "demo" })}
          />
          <button
            type="button"
            onClick={copy}
            className="flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-card px-3.5 text-sm font-medium hover:bg-muted"
          >
            <LinkIcon className="size-4" />
            Copiar link
          </button>
        </div>
      </div>

      <div
        aria-busy={pending}
        className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[10px] border bg-card px-3 py-2.5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Rango"
            options={presets}
            value={state.preset}
            onPick={pickPreset}
          />
          {state.preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Desde"
                value={state.from ?? range.from}
                max={state.to ?? today}
                onChange={(e) => e.target.value && go({ from: e.target.value })}
                className="h-8 rounded-lg border border-border-strong bg-card px-2 text-[13px] [color-scheme:light] dark:[color-scheme:dark]"
              />
              <span className="text-[13px] text-muted-foreground">a</span>
              <input
                type="date"
                aria-label="Hasta"
                value={state.to ?? range.to}
                min={state.from ?? undefined}
                max={today}
                onChange={(e) => e.target.value && go({ to: e.target.value })}
                className="h-8 rounded-lg border border-border-strong bg-card px-2 text-[13px] [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
          )}
        </div>
        <Segmented
          label="Distancia"
          options={[
            { value: null, label: "Todas" },
            ...DISTANCE_BANDS.map((b) => ({ value: b, label: BAND_LABEL[b] })),
          ]}
          value={bandApplied ? state.band : null}
          onPick={(band) => go({ band })}
          disabled={
            bandApplied
              ? undefined
              : "Este reporte no se puede filtrar por distancia."
          }
        />
        <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
          {rangeLabel(range)} · vs {rangeLabel(previousRange(range), false)}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Reportes"
        className="flex flex-wrap border-b"
      >
        {REPORT_TABS.map((t) => {
          const Icon = TAB_ICON[t.icon]
          const on = t.id === state.tab
          return (
            <Link
              key={t.id}
              role="tab"
              aria-selected={on}
              href={metricsHref({
                ...state,
                tab: t.id,
                dispute: t.id === "disputes" ? state.dispute : null,
              })}
              scroll={false}
              className={cn(
                "-mb-px flex h-[42px] flex-none items-center gap-[7px] border-b-2 px-2.5 text-sm font-medium whitespace-nowrap",
                on
                  ? "border-foreground text-foreground"
                  : "border-transparent text-fg2 hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </Link>
          )
        })}
      </div>
    </>
  )
}
