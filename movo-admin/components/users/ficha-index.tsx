"use client"
import { cn } from "@/lib/utils"
import {
  jumpToSection,
  stateOf,
  useActiveSection,
  useFicha,
} from "./ficha-status"
import { SECTION_IDS, SECTION_META } from "./sections-meta"

/** Índice lateral sticky "En esta ficha": estado de carga/error por sección y scroll-spy. */
export function FichaIndex() {
  const ficha = useFicha()
  const active = useActiveSection()
  return (
    <nav
      aria-label="Secciones de la ficha"
      className="sticky top-5 hidden flex-col gap-0.5 min-[1100px]:flex"
    >
      <span className="px-2.5 pb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        En esta ficha
      </span>
      {SECTION_IDS.map((id) => {
        const meta = SECTION_META[id]
        const Icon = meta.icon
        const on = active === id
        const state = stateOf(ficha, id)
        return (
          <button
            key={id}
            type="button"
            onClick={() => jumpToSection(id)}
            aria-current={on ? "location" : undefined}
            className={cn(
              "relative flex h-[34px] items-center gap-2 rounded-md px-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on
                ? "bg-muted font-medium text-foreground"
                : "text-fg2 hover:text-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[3px]",
                on ? "bg-lime" : "bg-transparent"
              )}
            />
            <Icon
              aria-hidden
              className={cn(
                "size-[15px]",
                on ? "text-foreground" : "text-muted-foreground"
              )}
            />
            <span className="flex-1 whitespace-nowrap">{meta.label}</span>
            {state.status === "loading" && (
              <span
                role="status"
                aria-label="Cargando"
                className="size-2.5 animate-spin rounded-full border-[1.5px] border-border-strong border-t-fg2 motion-reduce:animate-none"
              />
            )}
            {state.status === "error" && (
              <span
                role="img"
                aria-label="No cargó"
                title="No cargó"
                className="size-[7px] rounded-full bg-dot-danger"
              />
            )}
            {state.status === "ready" && state.count !== undefined && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {state.count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
