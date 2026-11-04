import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/** Título + subtítulo de una pantalla. */
export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  )
}

/** Fila con avatar, dos líneas de texto y una acción, como las listas del panel. */
export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-surface-sub px-3 py-2.5">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-40 max-w-full" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className="h-8 w-20" />
    </div>
  )
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  )
}

/** Tarjetas de la grilla de inicio. */
export function CardGridSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-[10px] border p-5">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3.5 w-36 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Contenedor de página con el mismo ancho y padding que las pantallas reales. */
export function PageSkeleton({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <SkeletonGroup
      className={cn(
        "mx-auto flex max-w-[1080px] flex-col gap-8 px-5 pt-8 pb-16 md:px-8 md:pt-10",
        className
      )}
    >
      {children}
    </SkeletonGroup>
  )
}

/** Encabezado de una tabla del panel y sus filas (Inicio, Bitácora). */
export function TableSkeleton({
  rows = 8,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div
      className={cn("overflow-hidden rounded-[10px] border bg-card", className)}
    >
      <div className="h-10 border-b bg-surface-sub" />
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b px-[18px] py-4"
        >
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-5 w-1/4 rounded-full" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

/** Tarjetas de KPI de Métricas. */
export function KpiRowSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          className="flex h-[118px] flex-col gap-3 rounded-[10px] border bg-card p-[18px]"
        >
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-40 max-w-full" />
        </div>
      ))}
    </div>
  )
}

/** Gráfico de tendencia y panel de desglose de Métricas. */
export function ChartPanelsSkeleton() {
  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex h-[380px] min-w-0 flex-[2_1_520px] flex-col gap-3 rounded-[10px] border bg-card p-[18px]">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-72 max-w-full" />
        <Skeleton className="mt-4 flex-1 rounded-lg" />
      </div>
      <div className="flex h-[380px] min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-[10px] border bg-card p-[18px]">
        <Skeleton className="h-4 w-36" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
