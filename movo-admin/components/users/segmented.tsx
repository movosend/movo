"use client"
import { cn } from "@/lib/utils"

/** Pestañas en píldora del prototipo (fondo gris, la activa blanca con sombra). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-0.5 rounded-lg bg-muted p-[3px]"
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on
                ? "bg-card text-foreground shadow-[var(--shadow-1)]"
                : "text-fg2 hover:text-foreground"
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
