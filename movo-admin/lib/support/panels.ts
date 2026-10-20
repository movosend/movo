/**
 * Tamaño y estado (colapsado o no) de las dos columnas laterales de la bandeja: la lista de
 * consultas (izquierda) y el contexto del usuario (derecha). Se guarda en la cookie `support_panels`
 * (no en localStorage) para que el servidor dibuje el ancho correcto desde el primer render, sin
 * parpadeo, igual que `sidebar_state`.
 */
export interface PanelState {
  list: number
  listCollapsed: boolean
  context: number
  contextCollapsed: boolean
}

export const PANELS_COOKIE = "support_panels"
export const LIST_LIMITS = { min: 260, max: 480, default: 320 } as const
export const CONTEXT_LIMITS = { min: 280, max: 480, default: 320 } as const

export const DEFAULT_PANELS: PanelState = {
  list: LIST_LIMITS.default,
  listCollapsed: false,
  context: CONTEXT_LIMITS.default,
  contextCollapsed: false,
}

export const clampWidth = (
  value: number,
  limits: { min: number; max: number }
) => Math.min(limits.max, Math.max(limits.min, Math.round(value)))

/** Lee la cookie sin confiar en ella: cualquier valor raro vuelve al default. */
export function parsePanels(raw: string | undefined | null): PanelState {
  if (!raw) return DEFAULT_PANELS
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<PanelState>
    const num = (
      v: unknown,
      limits: { min: number; max: number; default: number }
    ) =>
      typeof v === "number" && Number.isFinite(v)
        ? clampWidth(v, limits)
        : limits.default
    return {
      list: num(value.list, LIST_LIMITS),
      listCollapsed: value.listCollapsed === true,
      context: num(value.context, CONTEXT_LIMITS),
      contextCollapsed: value.contextCollapsed === true,
    }
  } catch {
    return DEFAULT_PANELS
  }
}

export const serializePanels = (state: PanelState) =>
  encodeURIComponent(JSON.stringify(state))
