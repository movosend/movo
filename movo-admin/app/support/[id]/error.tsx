"use client"
import { RotateCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function ThreadError({ reset }: { reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <TriangleAlert aria-hidden className="size-8 text-danger-fg" />
      <p className="text-sm font-medium">No pudimos cargar la conversación.</p>
      <p className="max-w-xs text-[13px] text-muted-foreground">
        La lista y el resto del panel siguen funcionando.
      </p>
      <Button variant="outline" onClick={reset}>
        <RotateCw /> Reintentar
      </Button>
    </div>
  )
}
