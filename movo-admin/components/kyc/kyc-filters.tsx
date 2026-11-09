"use client"
import { useEffect, useRef, useState, useTransition } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import type { AdminKycVerificationType } from "@movo/shared/src/types/admin-kyc"
import { KYC_TYPE_LABEL } from "@/lib/kyc/format"
import { cn } from "@/lib/utils"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { KYC_COLUMNS, KycHeader } from "./review-table"

const DEBOUNCE_MS = 250
const TYPES: { value: AdminKycVerificationType | undefined; label: string }[] =
  [
    { value: undefined, label: "Todas" },
    { value: "identity", label: KYC_TYPE_LABEL.identity },
    { value: "license", label: KYC_TYPE_LABEL.license },
  ]

/**
 * Búsqueda (nombre, email o id de sesión) y filtro por tipo de la cola de KYC. Escriben `q` y `type` en la URL
 * (la página del servidor devuelve los resultados) y vuelven a la primera página. Los resultados llegan como children.
 */
export function KycFilters({
  initialQuery,
  initialType,
  label,
  children,
}: {
  initialQuery: string
  initialType: AdminKycVerificationType | undefined
  label: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [value, setValue] = useState(initialQuery)
  const [pending, start] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Último `type` pedido: el debounce de la búsqueda no puede pisarlo con uno viejo.
  const typeRef = useRef(initialType)

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    typeRef.current = initialType
  }, [initialType])

  const [seen, setSeen] = useState(initialQuery)
  const [pushed, setPushed] = useState(initialQuery)
  if (seen !== initialQuery) {
    setSeen(initialQuery)
    if (initialQuery !== pushed) setValue(initialQuery)
  }

  const push = (q: string, type: AdminKycVerificationType | undefined) => {
    setPushed(q)
    typeRef.current = type
    const params = new URLSearchParams({
      ...(q ? { q } : {}),
      ...(type ? { type } : {}),
    })
    start(() =>
      router.replace(params.size ? `${pathname}?${params}` : pathname, {
        scroll: false,
      })
    )
  }

  const change = (next: string) => {
    setValue(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(
      () => push(next.trim(), typeRef.current),
      DEBOUNCE_MS
    )
  }

  const clear = () => {
    clearTimeout(timer.current)
    setValue("")
    push("", typeRef.current)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex h-11 max-w-[460px] min-w-[260px] flex-1 items-center gap-2.5 rounded-lg border border-border-strong bg-card px-3.5 text-muted-foreground focus-within:border-foreground">
          <Search aria-hidden className="size-[18px]" />
          <input
            type="search"
            aria-label="Buscar verificaciones"
            placeholder="Nombre, email o id de sesión"
            value={value}
            onChange={(e) => change(e.target.value)}
            maxLength={100}
            className="h-full min-w-0 flex-1 appearance-none border-none bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
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
        <div
          role="group"
          aria-label="Tipo de verificación"
          className="inline-flex rounded-lg border border-border-strong bg-card p-0.5"
        >
          {TYPES.map((t) => {
            const active = initialType === t.value
            return (
              <button
                key={t.label}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  clearTimeout(timer.current)
                  push(value.trim(), t.value)
                }}
                className={cn(
                  "h-9 rounded-md px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-foreground text-background"
                    : "text-fg2 hover:bg-muted"
                )}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <span className="text-[13px] text-muted-foreground" aria-live="polite">
          {pending ? "Buscando…" : label}
        </span>
      </div>
      <div className="overflow-hidden rounded-[10px] border bg-card">
        <KycHeader />
        {pending ? <RowsSkeleton /> : children}
      </div>
    </>
  )
}

function RowsSkeleton() {
  return (
    <SkeletonGroup label="Buscando…">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`grid items-center gap-4 border-b px-[18px] py-4 ${KYC_COLUMNS}`}
        >
          <span className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3 w-3/5" />
          </span>
          <Skeleton className="hidden h-5 w-[70px] rounded-full min-[900px]:block" />
          <Skeleton className="hidden h-3 w-[70%] min-[900px]:block" />
          <Skeleton className="ml-auto h-3 w-[80px]" />
        </div>
      ))}
    </SkeletonGroup>
  )
}
