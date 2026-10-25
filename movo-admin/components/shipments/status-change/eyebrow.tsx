import type { ReactNode } from "react"

/** Título chico en mayúsculas de cada bloque del modal ("Siguiente en el flujo", "Qué va a pasar"). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </span>
  )
}
