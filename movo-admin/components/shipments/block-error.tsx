"use client"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { RotateCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Error de un bloque del detalle (AC13): queda en su lugar y el resto se ve. "Reintentar" vuelve a
 * pedir la página; los bloques que ya cargaron se vuelven a dibujar con sus datos.
 */
export function BlockError({
  noun,
  code,
  className,
}: {
  /** "el pago", "las partes"… */
  noun: string
  code?: string | null
  className?: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div
      role="alert"
      className={
        className ??
        "flex flex-wrap items-start gap-3 rounded-lg bg-danger-soft p-3.5"
      }
    >
      <TriangleAlert
        aria-hidden
        className="mt-px size-[18px] flex-none text-danger-fg"
      />
      <div className="flex min-w-[160px] flex-1 flex-col gap-1">
        <span className="text-sm font-medium">No pudimos cargar {noun}.</span>
        <span className="text-[13px] text-fg2">
          El resto del envío no se ve afectado.
        </span>
        {code && (
          <span className="font-mono text-xs text-muted-foreground">
            {code}
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => start(() => router.refresh())}
      >
        <RotateCw
          aria-hidden
          className={pending ? "animate-spin" : undefined}
        />
        Reintentar
      </Button>
    </div>
  )
}
