"use client"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { RotateCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SECTION_META, type SectionId } from "./sections-meta"
import { ReportSection } from "./ficha-status"

const STATUS_TEXT: Record<number, string> = {
  404: "Not Found",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
}

/**
 * Error de una sección: queda en su lugar, dice que el resto de la ficha no se ve afectado y deja
 * reintentar. "Reintentar" vuelve a pedir la página (las secciones ya cargadas no se ven afectadas).
 */
export function SectionError({
  id,
  userId,
  status,
}: {
  id: SectionId
  userId: string
  status: number
}) {
  const meta = SECTION_META[id]
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <div
      role="alert"
      className="m-[18px] flex flex-wrap items-start gap-3 rounded-lg bg-danger-soft p-3.5"
    >
      <ReportSection id={id} status="error" />
      <TriangleAlert aria-hidden className="mt-px size-[18px] text-danger-fg" />
      <div className="flex min-w-[200px] flex-1 flex-col gap-1">
        <span className="text-sm font-medium">
          No pudimos cargar {meta.noun}.
        </span>
        <span className="text-[13px] text-fg2">
          El resto de la ficha no se ve afectado.
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          GET /admin/users/{userId.slice(0, 8)}…{meta.route} · {status}{" "}
          {STATUS_TEXT[status] ?? "Error"}
        </span>
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
