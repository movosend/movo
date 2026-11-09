"use client"
import type { ReactNode } from "react"
import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react"
import { ADMIN_ACTION_REASON_MAX_LENGTH } from "@movo/shared/src/types/admin-users"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/** Motivo obligatorio de una acción: queda en la bitácora con el nombre de quien la hace. */
export function ReasonField({
  id,
  value,
  onChange,
  disabled,
  max = ADMIN_ACTION_REASON_MAX_LENGTH,
  min,
  label = "Motivo",
  hint = "Queda en la bitácora con tu nombre. La persona no lo ve.",
  placeholder,
  autoFocus,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  max?: number
  /**
   * Largo mínimo (sin contar espacios de los bordes, como lo cuenta el backend). Con él, mientras falte se muestra
   * "Faltan N caracteres" y una barra que se llena hasta el mínimo, en vez del contador.
   */
  min?: number
  label?: string
  hint?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const length = value.trim().length
  const missing = min !== undefined ? Math.max(0, min - length) : 0
  const statusId = `${id}-status`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
        {min !== undefined && (
          <span className="font-normal text-muted-foreground">
            {" "}
            · mínimo {min} caracteres
          </span>
        )}
      </label>
      <Textarea
        id={id}
        value={value}
        maxLength={max}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-describedby={min !== undefined ? statusId : undefined}
        aria-invalid={min !== undefined && length > 0 && missing > 0 ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[72px]"
      />
      {min !== undefined && (
        <div
          aria-hidden
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none",
              missing > 0 ? "bg-dot-warning" : "bg-dot-success"
            )}
            style={{ width: `${Math.min(100, (length / min) * 100)}%` }}
          />
        </div>
      )}
      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
        <span>{hint}</span>
        {min !== undefined ? (
          <span
            id={statusId}
            aria-live="polite"
            className={cn(
              "flex flex-none items-center gap-1 font-medium whitespace-nowrap tabular-nums",
              missing > 0 ? "text-warn-fg" : "text-success-fg"
            )}
          >
            {missing > 0 ? (
              `Faltan ${missing} ${missing === 1 ? "carácter" : "caracteres"}`
            ) : (
              <>
                <CircleCheck aria-hidden className="size-3.5" />
                {value.length}/{max}
              </>
            )}
          </span>
        ) : (
          <span className="tabular-nums">
            {value.length}/{max}
          </span>
        )}
      </div>
    </div>
  )
}

export function ActionError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-[13px] text-danger-fg"
    >
      <TriangleAlert aria-hidden className="mt-px size-4 flex-none" />
      <span>{message}</span>
    </div>
  )
}

/** Lo que va a pasar si se confirma, una línea por efecto. */
export function Consequences({
  title = "Qué va a pasar",
  items,
}: {
  title?: string
  items: ReactNode[]
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-surface-sub p-3.5">
      <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </span>
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-[13px] leading-snug"
          >
            <ArrowRight
              aria-hidden
              className="mt-0.5 size-3.5 flex-none text-muted-foreground"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AckCheck({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-[13px] leading-snug",
        checked ? "border-border-strong bg-muted" : "bg-card"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 flex-none accent-foreground"
      />
      <span>{children}</span>
    </label>
  )
}

/** Cierre de una acción que salió bien: qué pasó, en líneas cortas, y un solo botón. */
export function DoneState({
  title,
  lines,
  onClose,
}: {
  title: string
  lines: ReactNode[]
  onClose: () => void
}) {
  return (
    <>
      <div className="flex flex-col items-start gap-3 px-5 pt-4 pb-5">
        <span className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success-fg">
          <CircleCheck aria-hidden className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <span role="status" className="text-sm font-medium">
            {title}
          </span>
          {lines.map((line, i) => (
            <span key={i} className="text-[13px] text-fg2">
              {line}
            </span>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t px-5 py-4">
        <Button type="button" onClick={onClose}>
          Listo
        </Button>
      </div>
    </>
  )
}
