"use client"
import { useParams } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import { Headset } from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

const SIDEBAR_COLLAPSE_BELOW_PX = 1200

/**
 * Tres columnas de la bandeja (AC1): lista (300–320 px) | conversación (flexible) | contexto
 * (320 px, lo dibuja la conversación). Bajo 1200 px la barra lateral pasa a íconos; en pantallas
 * angostas se ve una columna a la vez (lista, o conversación con un link para volver).
 */
export function InboxFrame({
  list,
  children,
}: {
  list: ReactNode
  children: ReactNode
}) {
  const { id } = useParams<{ id?: string }>()
  const { setOpen } = useSidebar()
  useEffect(() => {
    if (window.innerWidth < SIDEBAR_COLLAPSE_BELOW_PX) setOpen(false)
    // Solo al entrar a la bandeja: después manda el botón de la barra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] min-[1100px]:grid-cols-[320px_minmax(0,1fr)]">
      <div className={cn("flex min-h-0 min-w-0 flex-col", id && "max-md:hidden")}>{list}</div>
      <div className={cn("flex min-h-0 min-w-0", !id && "max-md:hidden")}>{children}</div>
    </div>
  )
}

export function EmptyThread() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
      <Headset aria-hidden className="size-8" />
      <p className="text-sm font-medium text-foreground">Elegí una consulta</p>
      <p className="max-w-xs text-[13px]">
        Seleccioná una conversación de la lista para responder o dejar una nota interna.
      </p>
    </div>
  )
}
