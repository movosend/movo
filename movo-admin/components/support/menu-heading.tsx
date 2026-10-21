import type { ReactNode } from "react"

/** Título de un menú desplegable (el `DropdownMenuLabel` de Base UI exige un grupo padre). */
export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div
      role="presentation"
      className="px-2 py-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
    >
      {children}
    </div>
  )
}
