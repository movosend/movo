"use client"
import { useEffect, useState } from "react"

/**
 * Disputas abiertas para el badge del menú. Se pide una vez al montar el shell (cada página lo monta de
 * nuevo) y, si falla, el badge no se muestra: nunca bloquea ni muestra un error en el menú.
 * Sin `enabled` (modo carga del shell) no pide nada.
 */
export function useOpenDisputes(enabled: boolean): number | null {
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch("/api/disputes/count", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { open?: number } | null) => {
        if (typeof data?.open === "number") setOpen(data.open)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [enabled])
  return open
}
