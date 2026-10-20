import type { ReactNode } from "react"
import { PanelProvider } from "./panel-layout"
import { DEFAULT_PANELS } from "@/lib/support/panels"

/** Las columnas de la bandeja leen el tamaño de los paneles: los tests las envuelven con esto. */
export function withPanels(ui: ReactNode) {
  window.matchMedia ??= ((q: string) => ({
    matches: true,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  return <PanelProvider initial={DEFAULT_PANELS}>{ui}</PanelProvider>
}
