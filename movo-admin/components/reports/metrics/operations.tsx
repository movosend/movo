"use client"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { MapPin } from "lucide-react"
import type { OperationsReport } from "@movo/shared/src/types/admin-reports"
import { metricsHref, type MetricsState } from "@/lib/reports/params"

/**
 * Ciudad del punto de retiro de Operación (MOVO-35). Las opciones son las ciudades con envíos publicados en
 * el rango (`cities`, que el backend arma sin el filtro), así nunca se ofrece una ciudad vacía. La elegida
 * se conserva aunque no tenga publicados en un rango nuevo, para que el admin vea que no hubo.
 */
export function CityPicker({
  report,
  state,
}: {
  report: OperationsReport
  state: MetricsState
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const selected = report.city ?? ""
  const options = report.cities.some((c) => c.city === selected)
    ? report.cities
    : selected
      ? [{ city: selected, published: 0 }, ...report.cities]
      : report.cities
  return (
    <label
      aria-busy={pending}
      className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <MapPin className="size-3.5" />
        Ciudad de retiro
      </span>
      <select
        value={selected}
        onChange={(e) =>
          start(() =>
            router.push(
              metricsHref({ ...state, city: e.target.value || null }),
              { scroll: false }
            )
          )
        }
        className="h-8 min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-2 text-[13px] sm:w-[240px] sm:flex-none"
      >
        <option value="">Todas las ciudades</option>
        {options.map((c) => (
          <option key={c.city} value={c.city}>
            {c.city} ({c.published})
          </option>
        ))}
      </select>
    </label>
  )
}
