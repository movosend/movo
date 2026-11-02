"use client"
import { useState } from "react"
import { Download } from "lucide-react"
import {
  EXPORT_ROWS_HEADER,
  EXPORT_TRUNCATED_HEADER,
} from "@movo/shared/src/types/admin-reports"
import { cn } from "@/lib/utils"
import { useToast } from "./toasts"

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const fileName = (res: Response, fallback: string) =>
  /filename="?([^";]+)"?/i.exec(
    res.headers.get("content-disposition") ?? ""
  )?.[1] ?? fallback

/**
 * Baja un CSV del Route Handler y avisa con "CSV listo · N filas" (y "Bajar de nuevo", sin volver a
 * pedirlo). Si el backend cortó por el tope de filas, el aviso lo dice.
 */
export function useCsvDownload() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (
    href: string,
    opts: { fallbackName: string; note?: string }
  ) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(href, { headers: { Accept: "text/csv" } })
      if (!res.ok) {
        toast({
          tone: "danger",
          title: "No pudimos generar el CSV",
          sub: "Volvé a intentar en unos segundos.",
        })
        return
      }
      const blob = await res.blob()
      const name = fileName(res, opts.fallbackName)
      const rows = res.headers.get(EXPORT_ROWS_HEADER)
      const truncated = res.headers.get(EXPORT_TRUNCATED_HEADER) === "true"
      save(name, blob)
      const parts = [
        name,
        rows != null && `${rows} filas`,
        truncated
          ? "se cortó en el máximo de filas: acotá el filtro"
          : opts.note,
      ].filter(Boolean)
      toast({
        title: "CSV listo",
        sub: parts.join(" · "),
        action: { label: "Bajar de nuevo", run: () => save(name, blob) },
      })
    } catch {
      toast({
        tone: "danger",
        title: "No pudimos generar el CSV",
        sub: "Revisá la conexión y volvé a intentar.",
      })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-3 animate-spin rounded-full border-2 border-current border-r-transparent",
        className
      )}
    />
  )
}

/** Botón chico "CSV" de cada gráfico o tabla de Métricas. */
export function CsvButton({
  href,
  fallbackName,
  label = "CSV",
}: {
  href: string
  fallbackName: string
  label?: string
}) {
  const { busy, run } = useCsvDownload()
  return (
    <button
      type="button"
      onClick={() => run(href, { fallbackName })}
      disabled={busy}
      aria-busy={busy}
      className="flex h-[30px] flex-none items-center gap-1.5 rounded-lg border border-border-strong bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-70"
    >
      {busy ? <Spinner /> : <Download className="size-4" />}
      {label}
    </button>
  )
}
