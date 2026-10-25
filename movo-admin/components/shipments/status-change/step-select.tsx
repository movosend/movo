"use client"
import { ChevronRight, CircleAlert, Info } from "lucide-react"
import type { ShipmentStatusOptions } from "@movo/shared/src/types/admin-shipments"
import type { ShipmentStatusValue } from "@/lib/shipments/format"
import { cn } from "@/lib/utils"
import { noFlowText, RISK, statusLabel } from "./copy"
import { Eyebrow } from "./eyebrow"

/** Una transición posible: radio con su resumen de una línea y la pastilla de riesgo. */
function OptionCard({
  status,
  summary,
  risk,
  selected,
  onPick,
  disabled,
}: {
  status: ShipmentStatusValue
  summary: string
  risk: keyof typeof RISK
  selected: boolean
  onPick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border px-3.5 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected
          ? "border-foreground bg-card shadow-[0_0_0_3px_var(--ring)]"
          : "bg-card hover:bg-muted"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 size-4 rounded-full",
          selected
            ? "border-[5px] border-foreground"
            : "border-[1.5px] border-border-strong"
        )}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">{statusLabel(status)}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {status}
          </span>
        </span>
        <span className="text-[13px] leading-snug text-fg2">{summary}</span>
      </span>
      {risk && (
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold whitespace-nowrap",
            RISK[risk].badge
          )}
        >
          {RISK[risk].label}
        </span>
      )}
    </button>
  )
}

/** Los bloqueados con el mismo motivo se muestran juntos: diez filas con el mismo texto serían ruido. */
function blockedByReason(
  blocked: ShipmentStatusOptions["blocked"]
): Array<[string, ShipmentStatusValue[]]> {
  const groups = new Map<string, ShipmentStatusValue[]>()
  for (const b of blocked)
    groups.set(b.reason, [...(groups.get(b.reason) ?? []), b.targetStatus])
  return [...groups.entries()]
}

/** Estados que no se pueden elegir desde acá, atenuados, con el motivo. */
function BlockedGroup({
  reason,
  statuses,
}: {
  reason: string
  statuses: ShipmentStatusValue[]
}) {
  return (
    <div
      role="note"
      className="flex flex-col gap-1.5 rounded-lg border bg-card px-3.5 py-3 opacity-60"
    >
      <span className="text-[13px] leading-snug text-fg2">{reason}</span>
      <span className="flex flex-wrap gap-1.5">
        {statuses.map((status) => (
          <span
            key={status}
            className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] font-medium text-fg2"
          >
            {statusLabel(status)}
          </span>
        ))}
      </span>
    </div>
  )
}

/** Paso 1: a qué estado pasar. El flujo normal arriba; lo forzado y lo bloqueado, en un bloque colapsado. */
export function StepSelect({
  options,
  target,
  showForced,
  onPick,
  onToggleForced,
  disabled,
}: {
  options: ShipmentStatusOptions
  target: ShipmentStatusValue | null
  showForced: boolean
  onPick: (status: ShipmentStatusValue) => void
  onToggleForced: () => void
  disabled?: boolean
}) {
  const flow = options.options.filter((o) => o.kind === "manual")
  const forced = options.options.filter((o) => o.kind === "forced")
  const hasOutside = forced.length > 0 || options.blocked.length > 0
  // Sin nada en el flujo (terminal o en disputa) el bloque de afuera es lo único que hay: se muestra abierto.
  const outsideOpen = showForced || flow.length === 0
  return (
    <>
      {flow.length === 0 && (
        <div className="flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-3 text-[13px] leading-relaxed text-fg2">
          <Info
            aria-hidden
            className="mt-0.5 size-4 flex-none text-foreground"
          />
          <span className="text-pretty">{noFlowText(options.current)}</span>
        </div>
      )}
      {flow.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Siguiente en el flujo</Eyebrow>
          <div
            role="radiogroup"
            aria-label="Nuevo estado"
            className="flex flex-col gap-2"
          >
            {flow.map((o) => (
              <OptionCard
                key={o.targetStatus}
                status={o.targetStatus}
                summary={o.effects[0] ?? ""}
                risk={o.risk}
                selected={target === o.targetStatus}
                disabled={disabled}
                onPick={() => onPick(o.targetStatus)}
              />
            ))}
          </div>
        </div>
      )}
      {hasOutside && (
        <>
          {flow.length > 0 && (
            <button
              type="button"
              aria-expanded={outsideOpen}
              aria-controls="status-change-outside"
              onClick={onToggleForced}
              className="flex items-center gap-1.5 self-start rounded py-1 text-[13px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "size-3.5 transition-transform duration-200",
                  outsideOpen && "rotate-90"
                )}
              />
              Fuera del flujo
            </button>
          )}
          {outsideOpen && (
            <div id="status-change-outside" className="flex flex-col gap-2">
              {forced.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg bg-danger-soft px-3.5 py-3 text-[13px] leading-relaxed text-danger-fg">
                  <CircleAlert
                    aria-hidden
                    className="mt-0.5 size-4 flex-none"
                  />
                  <span className="text-pretty">
                    <strong className="font-semibold">
                      Se ejecutan con efectos distintos del camino normal
                    </strong>{" "}
                    (por ejemplo, sin penalidad). Quedan marcados como forzados
                    en la línea de tiempo y en la bitácora. Usalos para
                    destrabar un envío, nunca para apurar uno.
                  </span>
                </div>
              )}
              <div
                role="radiogroup"
                aria-label="Fuera del flujo"
                className="flex flex-col gap-2"
              >
                {forced.map((o) => (
                  <OptionCard
                    key={o.targetStatus}
                    status={o.targetStatus}
                    summary={o.effects[0] ?? ""}
                    risk={o.risk}
                    selected={target === o.targetStatus}
                    disabled={disabled}
                    onPick={() => onPick(o.targetStatus)}
                  />
                ))}
                {blockedByReason(options.blocked).map(([reason, statuses]) => (
                  <BlockedGroup
                    key={reason}
                    reason={reason}
                    statuses={statuses}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
