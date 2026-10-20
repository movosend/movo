"use client"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { SECTION_IDS, type SectionId } from "./sections-meta"

export type SectionStatus = "loading" | "ready" | "error"

export interface SectionState {
  status: SectionStatus
  /** Número que muestra el índice lateral (envíos, reportes…). */
  count?: number
  /** Valor y subtítulo de la tira de KPIs de la cabecera. */
  kpi?: { value: string; sub?: string; tone?: "warn" }
}

interface Ficha {
  states: Partial<Record<SectionId, SectionState>>
  report: (id: SectionId, state: SectionState) => void
}

const FichaContext = createContext<Ficha | null>(null)

/** Cada sección de la ficha avisa acá cómo va (cargando, lista, con error) para el índice y los KPIs. */
export function FichaProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Ficha["states"]>({})
  const report = useCallback<Ficha["report"]>((id, state) => {
    setStates((prev) => {
      const old = prev[id]
      if (
        old &&
        old.status === state.status &&
        old.count === state.count &&
        old.kpi?.value === state.kpi?.value &&
        old.kpi?.sub === state.kpi?.sub &&
        old.kpi?.tone === state.kpi?.tone
      )
        return prev
      return { ...prev, [id]: state }
    })
  }, [])
  const value = useMemo(() => ({ states, report }), [states, report])
  return <FichaContext.Provider value={value}>{children}</FichaContext.Provider>
}

export function useFicha(): Ficha {
  const ctx = useContext(FichaContext)
  if (!ctx) throw new Error("useFicha fuera de FichaProvider")
  return ctx
}

export const stateOf = (ficha: Ficha, id: SectionId): SectionState =>
  ficha.states[id] ?? { status: "loading" }

/** Se monta junto al cuerpo de una sección y publica su estado. No dibuja nada. */
export function ReportSection({
  id,
  status,
  count,
  kpi,
}: { id: SectionId } & SectionState) {
  const { report } = useFicha()
  const kpiValue = kpi?.value
  const kpiSub = kpi?.sub
  const kpiTone = kpi?.tone
  useEffect(() => {
    report(id, {
      status,
      count,
      kpi:
        kpiValue === undefined
          ? undefined
          : { value: kpiValue, sub: kpiSub, tone: kpiTone },
    })
  }, [report, id, status, count, kpiValue, kpiSub, kpiTone])
  return null
}

/** Hace scroll suave a una sección dentro del contenedor principal del panel. */
export function jumpToSection(id: SectionId) {
  const el = document.getElementById(`sec-${id}`)
  if (!el) return
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
}

/** Sección que está debajo del borde superior del contenedor (scroll-spy del índice). */
export function useActiveSection(): SectionId {
  const [active, setActive] = useState<SectionId>("perfil")
  useEffect(() => {
    const main = document.getElementById("contenido")
    if (!main) return
    let raf = 0
    const spy = () => {
      raf = 0
      const base =
        main.getBoundingClientRect().top +
        Math.min(240, main.clientHeight * 0.3)
      let current: SectionId = SECTION_IDS[0]
      for (const id of SECTION_IDS) {
        const el = document.getElementById(`sec-${id}`)
        if (el && el.getBoundingClientRect().top - base <= 0) current = id
      }
      if (
        main.scrollTop > 0 &&
        main.scrollTop + main.clientHeight >= main.scrollHeight - 4
      )
        current = SECTION_IDS[SECTION_IDS.length - 1]
      setActive(current)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(spy)
    }
    main.addEventListener("scroll", onScroll, { passive: true })
    spy()
    return () => {
      main.removeEventListener("scroll", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  return active
}
