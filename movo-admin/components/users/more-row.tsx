"use client"
import { RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Pie de una lista paginada por cursor: "Ver más" y, si falló la página, el error con reintento. */
export function MoreRow({
  pending,
  failed,
  onMore,
  noun,
}: {
  pending: boolean
  failed: number | null
  onMore: () => void
  noun: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-b-[10px] bg-surface-sub px-[18px] py-2.5">
      <span
        className="flex-1 text-[13px] text-muted-foreground"
        role={failed ? "alert" : undefined}
      >
        {failed
          ? `No pudimos cargar más ${noun} (${failed}). El resto de la ficha no se ve afectado.`
          : `Hay más ${noun}.`}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={pending}
        onClick={onMore}
      >
        {failed && <RotateCw aria-hidden />}
        {pending ? "Cargando…" : failed ? "Reintentar" : "Ver más"}
      </Button>
    </div>
  )
}
