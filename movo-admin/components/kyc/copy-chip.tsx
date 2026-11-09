"use client"
import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"

/** Id en monoespaciada con botón de copiar (el id de la sesión de Didit, para buscarla en su consola). */
export function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined
        )
      }}
      aria-label={copied ? `${label} copiado` : `Copiar ${label}`}
      className="inline-flex h-7 max-w-full items-center gap-2 rounded-lg border bg-surface-sub px-2.5 font-mono text-xs text-fg2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check aria-hidden className="size-3.5 flex-none text-success-fg" />
      ) : (
        <Copy aria-hidden className="size-3.5 flex-none" />
      )}
    </button>
  )
}
