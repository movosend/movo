"use client"
import { useEffect, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { COLUMNS } from "./user-table"

const DEBOUNCE_MS = 250

/**
 * Buscador único (nombre, email, teléfono o DNI). Escribe `q` en la URL con un debounce y la
 * página del servidor devuelve los resultados; mientras tanto se ven filas en carga. Los
 * resultados (children) llegan renderizados por el servidor.
 */
export function UserSearch({
  initialQuery,
  label,
  children,
}: {
  initialQuery: string
  label: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [value, setValue] = useState(initialQuery)
  const [pending, start] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])
  // Si la URL cambia por otro camino (atrás/adelante), el campo la sigue; si la cambió este
  // mismo campo no se pisa lo que la persona sigue escribiendo.
  const [seen, setSeen] = useState(initialQuery)
  const [pushed, setPushed] = useState(initialQuery)
  if (seen !== initialQuery) {
    setSeen(initialQuery)
    if (initialQuery !== pushed) setValue(initialQuery)
  }

  const push = (q: string) => {
    setPushed(q)
    start(() =>
      router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, {
        scroll: false,
      })
    )
  }

  const change = (next: string) => {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => push(next.trim()), DEBOUNCE_MS)
  }

  const clear = () => {
    clearTimeout(timer.current)
    setValue("")
    push("")
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex h-11 max-w-[560px] min-w-[280px] flex-1 items-center gap-2.5 rounded-lg border border-border-strong bg-card px-3.5 text-muted-foreground focus-within:border-foreground">
          <Search aria-hidden className="size-[18px]" />
          <input
            type="search"
            aria-label="Buscar usuarios"
            placeholder="Nombre, email, teléfono o DNI"
            value={value}
            onChange={(e) => change(e.target.value)}
            maxLength={100}
            className="h-full min-w-0 flex-1 appearance-none border-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {pending && (
            <span
              role="status"
              aria-label="Buscando"
              className="size-3.5 animate-spin rounded-full border-2 border-border-strong border-t-foreground motion-reduce:animate-none"
            />
          )}
          {value && (
            <button
              type="button"
              onClick={clear}
              aria-label="Borrar búsqueda"
              className="flex size-[26px] items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </label>
        <span className="text-[13px] text-muted-foreground" aria-live="polite">
          {pending ? "Buscando…" : label}
        </span>
      </div>
      <div className="overflow-hidden rounded-[10px] border bg-card">
        <div
          className={`h-10 items-center gap-4 border-b bg-surface-sub px-[18px] text-xs font-medium text-muted-foreground ${COLUMNS} grid`}
        >
          <span>Usuario</span>
          <span className="hidden min-[1180px]:block">Teléfono · DNI</span>
          <span className="hidden min-[1180px]:block">Roles</span>
          <span>Cuenta</span>
          <span className="hidden min-[1180px]:block">KYC identidad</span>
          <span className="hidden min-[1180px]:block">KYC licencia</span>
          <span className="min-[1180px]:hidden">KYC</span>
          <span className="hidden text-right min-[1180px]:block">Alta</span>
        </div>
        {pending ? <RowsSkeleton /> : children}
      </div>
    </>
  )
}

function RowsSkeleton() {
  return (
    <SkeletonGroup label="Buscando…">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`grid items-center gap-4 border-b px-[18px] py-4 ${COLUMNS}`}
        >
          <span className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3 w-3/5" />
          </span>
          <Skeleton className="hidden h-3 w-[70%] min-[1180px]:block" />
          <Skeleton className="hidden h-5 w-[70px] rounded-full min-[1180px]:block" />
          <Skeleton className="h-5 w-[60px] rounded-full" />
          <Skeleton className="h-5 w-[70px] rounded-full" />
          <Skeleton className="hidden h-5 w-[70px] rounded-full min-[1180px]:block" />
          <Skeleton className="ml-auto hidden h-3 w-[60px] min-[1180px]:block" />
        </div>
      ))}
    </SkeletonGroup>
  )
}
