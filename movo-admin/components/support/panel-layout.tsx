"use client"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import {
  CONTEXT_LIMITS,
  LIST_LIMITS,
  PANELS_COOKIE,
  clampWidth,
  serializePanels,
  type PanelState,
} from "@/lib/support/panels"
import { cn } from "@/lib/utils"

type Side = "list" | "context"

interface PanelLayout {
  state: PanelState
  dragging: boolean
  /** `true` desde 1360 px: el contexto es una columna; antes es un `Sheet`. */
  wide: boolean
  resize: (side: Side, width: number, commit: boolean) => void
  reset: (side: Side) => void
  toggle: (side: Side) => void
  setDragging: (dragging: boolean) => void
}

const Ctx = createContext<PanelLayout | null>(null)

export function usePanels(): PanelLayout {
  const value = useContext(Ctx)
  if (!value) throw new Error("usePanels va dentro de PanelProvider")
  return value
}

const WIDE_QUERY = "(min-width: 1360px)"
const subscribeWide = (notify: () => void) => {
  const query = window.matchMedia(WIDE_QUERY)
  query.addEventListener("change", notify)
  return () => query.removeEventListener("change", notify)
}
const limitsOf = (side: Side) =>
  side === "list" ? LIST_LIMITS : CONTEXT_LIMITS

function save(state: PanelState) {
  try {
    document.cookie = `${PANELS_COOKIE}=${serializePanels(state)}; path=/; max-age=31536000; samesite=lax`
  } catch {
    // Sin cookies el panel funciona igual, solo que no recuerda el tamaño.
  }
}

/**
 * Estado compartido de las columnas laterales. Arrastrar actualiza el ancho en vivo; la cookie se
 * escribe al soltar (o en cada paso de teclado), no en cada píxel.
 */
export function PanelProvider({
  initial,
  children,
}: {
  initial: PanelState
  children: ReactNode
}) {
  const [state, setState] = useState(initial)
  const [dragging, setDragging] = useState(false)
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true
  )
  const latest = useRef(state)

  const apply = useCallback((next: PanelState, commit: boolean) => {
    latest.current = next
    setState(next)
    if (commit) save(next)
  }, [])

  const resize = useCallback(
    (side: Side, width: number, commit: boolean) => {
      const clamped = clampWidth(width, limitsOf(side))
      apply(
        side === "list"
          ? { ...latest.current, list: clamped, listCollapsed: false }
          : { ...latest.current, context: clamped, contextCollapsed: false },
        commit
      )
    },
    [apply]
  )
  const reset = useCallback(
    (side: Side) => resize(side, limitsOf(side).default, true),
    [resize]
  )
  const toggle = useCallback(
    (side: Side) => {
      const key = side === "list" ? "listCollapsed" : "contextCollapsed"
      apply({ ...latest.current, [key]: !latest.current[key] }, true)
    },
    [apply]
  )

  const value = useMemo(
    () => ({ state, dragging, wide, resize, reset, toggle, setDragging }),
    [state, dragging, wide, resize, reset, toggle]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const STEP_PX = 16
const BIG_STEP_PX = 48

/**
 * Borde arrastrable entre columnas (patrón "window splitter" de WAI-ARIA): con el mouse se arrastra,
 * con el teclado ←/→ cambian el ancho de a 16 px (Shift: 48), Inicio/Fin van al mínimo y al máximo,
 * Enter colapsa o expande, y doble clic vuelve al ancho original.
 */
export function ResizeHandle({ side, label }: { side: Side; label: string }) {
  const { state, resize, reset, toggle, setDragging } = usePanels()
  const limits = limitsOf(side)
  const width = side === "list" ? state.list : state.context
  const collapsed =
    side === "list" ? state.listCollapsed : state.contextCollapsed
  const start = useRef<{ x: number; width: number } | null>(null)
  // En la lista el borde es el derecho de la columna; en el contexto, el izquierdo.
  const sign = side === "list" ? 1 : -1

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, width }
    setDragging(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    resize(
      side,
      start.current.width + sign * (e.clientX - start.current.x),
      false
    )
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    resize(
      side,
      start.current.width + sign * (e.clientX - start.current.x),
      true
    )
    start.current = null
    setDragging(false)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP_PX : STEP_PX
    if (e.key === "ArrowRight") resize(side, width + sign * step, true)
    else if (e.key === "ArrowLeft") resize(side, width - sign * step, true)
    else if (e.key === "Home") resize(side, limits.min, true)
    else if (e.key === "End") resize(side, limits.max, true)
    else if (e.key === "Enter") toggle(side)
    else return
    e.preventDefault()
  }

  if (collapsed) return null
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Arrastrá para cambiar el ancho · doble clic para restablecer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => reset(side)}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute inset-y-0 z-20 hidden w-2 cursor-col-resize touch-none outline-none md:block",
        side === "list" ? "-right-1" : "-left-1"
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-border-strong group-focus-visible:bg-ring group-active:bg-ring"
      />
    </div>
  )
}

/**
 * Botón circular sobre el borde de una columna lateral: la oculta (chevron hacia ella) o la
 * vuelve a mostrar (chevron hacia el contenido). Abierto, queda centrado sobre el borde; colapsado,
 * se pega al costado de la pantalla para no desbordar. Va fuera de la columna, que al colapsar queda
 * inerte. Se posiciona respecto del contenedor `relative` que lo envuelve.
 */
export function EdgeToggle({
  side,
  label,
  className,
}: {
  side: Side
  label: { hide: string; show: string }
  className?: string
}) {
  const { state, toggle } = usePanels()
  const collapsed =
    side === "list" ? state.listCollapsed : state.contextCollapsed
  const width = side === "list" ? state.list : state.context
  const Icon = (side === "list") === collapsed ? ChevronRight : ChevronLeft
  const text = collapsed ? label.show : label.hide
  const offset = collapsed ? 6 : width
  return (
    <button
      type="button"
      onClick={() => toggle(side)}
      aria-label={text}
      aria-expanded={!collapsed}
      title={text}
      style={{
        [side === "list" ? "left" : "right"]: offset,
        transform: collapsed
          ? undefined
          : `translateX(${side === "list" ? "-50%" : "50%"})`,
      }}
      className={cn(
        "absolute top-1/2 z-30 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-card text-fg2 shadow-(--shadow-1) outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-[left,right] motion-safe:duration-200",
        className
      )}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  )
}
