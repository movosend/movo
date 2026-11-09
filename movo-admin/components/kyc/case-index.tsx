"use client"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { KYC_SECTIONS, sectionAnchor, type KycSectionId } from "@/lib/kyc/sections"

const jumpTo = (id: KycSectionId) => {
  const el = document.getElementById(sectionAnchor(id))
  if (!el) return
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
}

/**
 * Índice lateral del caso (sticky), con scroll-spy sobre `#contenido` como el de la ficha de usuario. Las secciones de Didit
 * llegan por streaming, así que cuáles existen se recalcula cuando cambia el contenido: las que Didit no informó quedan
 * apagadas en vez de desaparecer.
 */
export function CaseIndex({ counts }: { counts?: Partial<Record<KycSectionId, number>> }) {
  const [active, setActive] = useState<KycSectionId>("resumen")
  const [present, setPresent] = useState<ReadonlySet<KycSectionId>>(new Set())

  useEffect(() => {
    const main = document.getElementById("contenido")
    if (!main) return
    let raf = 0
    const spy = () => {
      raf = 0
      const found = new Set<KycSectionId>()
      const base = main.getBoundingClientRect().top + Math.min(200, main.clientHeight * 0.3)
      let current: KycSectionId = "resumen"
      for (const { id } of KYC_SECTIONS) {
        const el = document.getElementById(sectionAnchor(id))
        if (!el) continue
        found.add(id)
        if (el.getBoundingClientRect().top - base <= 0) current = id
      }
      if (main.scrollTop > 0 && main.scrollTop + main.clientHeight >= main.scrollHeight - 4) {
        const last = [...KYC_SECTIONS].reverse().find(({ id }) => found.has(id))
        if (last) current = last.id
      }
      setActive(current)
      setPresent((prev) =>
        prev.size === found.size && [...found].every((id) => prev.has(id)) ? prev : found
      )
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(spy)
    }
    main.addEventListener("scroll", schedule, { passive: true })
    const observer = new MutationObserver(schedule)
    observer.observe(main, { childList: true, subtree: true })
    spy()
    return () => {
      main.removeEventListener("scroll", schedule)
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <nav aria-label="Secciones del caso" className="flex flex-col gap-0.5 rounded-[14px] border bg-card p-2">
      <span className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Secciones
      </span>
      {KYC_SECTIONS.map(({ id, label, icon: Icon }) => {
        const on = active === id && present.has(id)
        const exists = present.has(id)
        const count = counts?.[id]
        return (
          <button
            key={id}
            type="button"
            disabled={!exists}
            onClick={() => jumpTo(id)}
            aria-current={on ? "location" : undefined}
            className={cn(
              "relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-45",
              on ? "bg-muted font-medium text-foreground" : "text-fg2 enabled:hover:bg-surface-sub enabled:hover:text-foreground"
            )}
          >
            <span
              aria-hidden
              className={cn("absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[3px]", on ? "bg-lime" : "bg-transparent")}
            />
            <Icon aria-hidden className={cn("size-[15px]", on ? "text-foreground" : "text-muted-foreground")} />
            <span className="flex-1 whitespace-nowrap">{label}</span>
            {count !== undefined && count > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
