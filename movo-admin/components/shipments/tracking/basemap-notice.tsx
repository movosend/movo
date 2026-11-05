import {
  BASEMAP_NOTICE,
  type BasemapProblem,
} from "@/lib/shipments/tracking/tiles"

/** Sin esto, un mapa sin teselas es un fondo liso que no dice por qué. */
export function BasemapNotice({ problem }: { problem: BasemapProblem | null }) {
  if (!problem) return null
  return (
    <p
      role="status"
      className="absolute bottom-2 left-2 z-[500] max-w-[80%] rounded-md border border-border bg-background/95 px-2 py-1 text-xs text-muted-foreground"
    >
      {BASEMAP_NOTICE[problem]}
    </p>
  )
}
