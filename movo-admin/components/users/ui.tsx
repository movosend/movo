import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { Pill, Tone } from "@/lib/users/format"
import { SECTION_META, type SectionId } from "./sections-meta"

export const TONE_BG: Record<Tone, string> = {
  success: "bg-success-soft text-success-fg",
  warning: "bg-warn-soft text-warn-fg",
  danger: "bg-danger-soft text-danger-fg",
  info: "bg-info-soft text-info-fg",
  neutral: "bg-muted text-fg2",
}

export const TONE_DOT: Record<Tone, string> = {
  success: "bg-dot-success",
  warning: "bg-dot-warning",
  danger: "bg-dot-danger",
  info: "bg-dot-info",
  neutral: "bg-muted-foreground",
}

/** Pill de estado del prototipo: 22 px, texto 12/500, con punto opcional. */
export function StatusPill({
  pill,
  dot = false,
  dotClassName,
  className,
}: {
  pill: Pill
  dot?: boolean
  /** Color propio del punto (p. ej. `mv-pulse-dot`, el lima "en vivo" de Envíos); por defecto, el del tono. */
  dotClassName?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-[9px] text-xs font-medium whitespace-nowrap",
        TONE_BG[pill.tone],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            dotClassName ?? TONE_DOT[pill.tone]
          )}
        />
      )}
      {pill.label}
    </span>
  )
}

/** Cuadrito de ícono de 30 px de la cabecera de cada sección. */
export function IconTile({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex size-[30px] flex-none items-center justify-center rounded-lg bg-muted text-foreground [&_svg]:size-4",
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * Marco de una sección de la ficha: cabecera fija (ícono, título, pista) y, a la derecha, un
 * `aside` opcional (pestañas, conteo). El cuerpo llega por streaming dentro de su propio Suspense.
 */
export function SectionShell({
  id,
  aside,
  hint,
  children,
}: {
  id: SectionId
  aside?: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  const meta = SECTION_META[id]
  const Icon = meta.icon
  return (
    <section
      id={`sec-${id}`}
      aria-labelledby={`sec-${id}-title`}
      className="scroll-mt-5 rounded-[10px] border bg-card"
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b px-[18px] py-3.5">
        <IconTile>
          <Icon aria-hidden />
        </IconTile>
        <h2 id={`sec-${id}-title`} className="text-[15px] font-semibold">
          {meta.title}
        </h2>
        {(hint ?? meta.hint) && (
          <span className="text-xs text-muted-foreground">
            {hint ?? meta.hint}
          </span>
        )}
        {aside && (
          <>
            <span className="flex-1" />
            {aside}
          </>
        )}
      </header>
      {children}
    </section>
  )
}

/** Estado vacío de una sección: círculo con puntos, título y una línea. */
export function SectionEmpty({
  icon: Icon,
  title,
  text,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  text?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 px-[18px] py-8 text-center",
        className
      )}
    >
      {Icon && (
        <span className="mv-empty-icon mb-1.5 flex size-12 items-center justify-center rounded-full border text-fg2">
          <Icon className="size-5" />
        </span>
      )}
      <span className="text-sm font-medium">{title}</span>
      {text && <span className="text-[13px] text-fg2">{text}</span>}
    </div>
  )
}

/** Etiqueta de grupo en mayúsculas chicas (Intentos, Bloqueó a, Saldo…). */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase",
        className
      )}
    >
      {children}
    </span>
  )
}
