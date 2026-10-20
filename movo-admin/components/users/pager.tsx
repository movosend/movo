import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** Páginas a mostrar: todas si son pocas, si no una ventana con la primera y la última. */
export function pageWindow(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1])
  const sorted = [...set]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b)
  const out: (number | "…")[] = []
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("…")
    out.push(n)
  })
  return out
}

const cell =
  "flex items-center justify-center rounded-lg border text-[13px] font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Paginador numerado del prototipo ("Mostrando 1–10 de 27" + flechas + números). Funciona con
 * links (`href`, el listado: la URL manda) o con botones (`onChange`, dentro de una sección).
 */
export function Pager({
  page,
  pageSize,
  total,
  size = 32,
  noun,
  href,
  onChange,
  disabled,
}: {
  page: number
  pageSize: number
  total: number
  size?: 30 | 32
  /** Si viene, se escribe "de 12 envíos"; si no, "de 12". */
  noun?: string
  href?: (page: number) => string
  onChange?: (page: number) => void
  disabled?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const box = size === 30 ? "size-[30px]" : "size-8"
  const numBox = size === 30 ? "h-[30px] min-w-[30px]" : "h-8 min-w-8"
  const go = (
    n: number,
    label: string,
    content: React.ReactNode,
    on = false
  ) => {
    const off = n < 1 || n > pages || disabled
    const cls = cn(
      cell,
      typeof content === "number" ? numBox : box,
      typeof content === "number" && "px-2",
      on
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border-strong bg-card text-foreground hover:bg-muted",
      off && !on && "pointer-events-none text-fg-disabled"
    )
    // En modo links (lo renderiza el servidor) no puede haber handlers: lo deshabilitado es un span.
    if (href)
      return off && !on ? (
        <span
          key={label}
          aria-label={label}
          aria-disabled="true"
          className={cls}
        >
          {content}
        </span>
      ) : (
        <Link
          key={label}
          href={href(n)}
          aria-label={label}
          aria-current={on ? "page" : undefined}
          className={cls}
          scroll={false}
        >
          {content}
        </Link>
      )
    return (
      <button
        key={label}
        type="button"
        disabled={off}
        aria-label={label}
        aria-current={on ? "page" : undefined}
        onClick={() => onChange?.(n)}
        className={cls}
      >
        {content}
      </button>
    )
  }
  return (
    <nav
      aria-label="Paginación"
      className="flex items-center gap-2 rounded-b-[10px] bg-surface-sub px-[18px] py-2.5 text-[13px] text-muted-foreground"
    >
      <span className="flex-1 tabular-nums">
        {total === 0
          ? "Sin resultados"
          : `${size === 30 ? "" : "Mostrando "}${from}–${to} de ${total}${noun ? ` ${noun}` : ""}`}
      </span>
      {go(page - 1, "Página anterior", <ChevronLeft className="size-4" />)}
      {pageWindow(page, pages).map((n, i) =>
        n === "…" ? (
          <span key={`gap${i}`} aria-hidden className="px-1">
            …
          </span>
        ) : (
          go(n, `Página ${n}`, n, n === page)
        )
      )}
      {go(page + 1, "Página siguiente", <ChevronRight className="size-4" />)}
    </nav>
  )
}
