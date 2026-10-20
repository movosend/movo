"use client"
import { Flag, Route, Star, Wallet, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { jumpToSection, stateOf, useFicha } from "./ficha-status"
import { Skeleton } from "@/components/ui/skeleton"
import type { SectionId } from "./sections-meta"

const KPIS: {
  id: SectionId
  label: string
  icon: LucideIcon
  /** Mosaico lima, como el de "Envíos" en el prototipo. */
  accent?: boolean
}[] = [
  { id: "actividad", label: "Envíos", icon: Route, accent: true },
  { id: "calificaciones", label: "Reputación", icon: Star },
  { id: "reportes", label: "Reportes recibidos", icon: Flag },
  { id: "cuenta", label: "Saldo", icon: Wallet },
]

/** Cuatro números de la cabecera. Cada uno carga con su sección y salta a ella al tocarlo. */
export function KpiStrip() {
  const ficha = useFicha()
  return (
    <div className="relative mt-5 grid grid-cols-2 gap-px border-t bg-border min-[1100px]:grid-cols-4">
      {KPIS.map(({ id, label, icon: Icon, accent }) => {
        const state = stateOf(ficha, id)
        const warn = state.kpi?.tone === "warn"
        return (
          <button
            key={id}
            type="button"
            onClick={() => jumpToSection(id)}
            className="flex items-center gap-3 bg-card px-5 py-3.5 text-left outline-none hover:bg-surface-sub focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span
              className={cn(
                "flex size-[38px] flex-none items-center justify-center rounded-[9px]",
                accent
                  ? "bg-lime text-[#0a0a0b]"
                  : warn
                    ? "bg-warn-soft text-warn-fg"
                    : "bg-muted text-foreground"
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-[3px]">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {label}
              </span>
              {state.status === "ready" && state.kpi && (
                <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                  <span
                    className={cn(
                      "text-[19px] leading-[1.1] font-semibold tracking-[-0.01em] tabular-nums",
                      warn && "text-warn-fg"
                    )}
                  >
                    {state.kpi.value}
                  </span>
                  {state.kpi.sub && (
                    <span className="text-xs text-muted-foreground">
                      {state.kpi.sub}
                    </span>
                  )}
                </span>
              )}
              {state.status === "loading" && (
                <Skeleton className="h-[19px] w-16" />
              )}
              {state.status === "error" && (
                <span className="text-[13px] font-medium text-danger-fg">
                  No cargó
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
