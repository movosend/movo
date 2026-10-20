"use client"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { ReportSection } from "./ficha-status"
import type { SectionId } from "./sections-meta"

/** Cuerpo en carga de una sección: tres barras, como el prototipo. Avisa su estado al índice. */
export function SectionLoading({
  id,
  rows = [40, 72, 56],
}: {
  id: SectionId
  rows?: number[]
}) {
  return (
    <SkeletonGroup
      label="Cargando sección…"
      className="flex flex-col gap-2.5 p-[18px]"
    >
      <ReportSection id={id} status="loading" />
      {rows.map((w, i) => (
        <Skeleton key={i} className="h-3 rounded" style={{ width: `${w}%` }} />
      ))}
    </SkeletonGroup>
  )
}
