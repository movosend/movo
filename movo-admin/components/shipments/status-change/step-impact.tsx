"use client"
import { ArrowRight, Bell, Gauge, Info, ShieldAlert, Undo2 } from "lucide-react"
import type { ShipmentStatusOption } from "@movo/shared/src/types/admin-shipments"
import type { ShipmentStatusValue } from "@/lib/shipments/format"
import { StatusPill } from "@/components/users/ui"
import { SHIPMENT_STATUS } from "@/lib/users/format"
import { cn } from "@/lib/utils"
import { recipientsText, RISK } from "./copy"
import { Eyebrow } from "./eyebrow"

function StatusChip({ status }: { status: ShipmentStatusValue }) {
  return (
    <span className="flex flex-col gap-1">
      <StatusPill pill={SHIPMENT_STATUS[status]} className="h-6 px-2.5" />
      <span className="font-mono text-[11px] text-muted-foreground">
        {status}
      </span>
    </span>
  )
}

/** Paso 2: qué va a pasar si se confirma, a quién se avisa y qué no se puede deshacer. */
export function StepImpact({
  from,
  to,
  option,
}: {
  from: ShipmentStatusValue
  to: ShipmentStatusValue
  option: ShipmentStatusOption
}) {
  const risk = RISK[option.risk]
  const forced = option.kind === "forced"
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border bg-surface-sub p-3.5">
        <StatusChip status={from} />
        <ArrowRight aria-hidden className="mb-4 size-4 text-muted-foreground" />
        <StatusChip status={to} />
        {forced && (
          <span className="mr-0 mb-4 ml-auto inline-flex h-[22px] items-center rounded-full bg-danger-soft px-[9px] text-xs font-semibold text-danger-fg">
            Fuera del flujo
          </span>
        )}
      </div>
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg px-3.5 py-3 text-[13px] leading-relaxed",
          risk.box
        )}
      >
        <Gauge aria-hidden className="mt-0.5 size-4 flex-none" />
        <span>
          <strong className="font-semibold">{risk.label}.</strong> {risk.text}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <Eyebrow>Qué va a pasar</Eyebrow>
        <ul className="flex flex-col gap-2">
          {option.effects.map((effect) => (
            <li
              key={effect}
              className="flex items-start gap-2.5 text-sm leading-snug"
            >
              <ArrowRight
                aria-hidden
                className="mt-0.5 size-3.5 flex-none text-muted-foreground"
              />
              <span className="text-pretty">{effect}</span>
            </li>
          ))}
          {forced && (
            <li className="flex items-start gap-2.5 text-sm leading-snug">
              <ShieldAlert
                aria-hidden
                className="mt-0.5 size-3.5 flex-none text-muted-foreground"
              />
              <span className="text-pretty">
                Queda marcado como forzado en la línea de tiempo y en la
                bitácora
              </span>
            </li>
          )}
        </ul>
      </div>
      <div className="flex items-center gap-2.5 text-[13px] text-fg2">
        <Bell aria-hidden className="size-3.5 text-muted-foreground" />
        <span>
          Avisamos a:{" "}
          <strong className="font-medium text-foreground">
            {recipientsText(option.notifies)}
          </strong>
        </span>
      </div>
      {option.checks.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg bg-info-soft px-3.5 py-3 text-[13px] leading-relaxed text-info-fg">
          <Info aria-hidden className="mt-0.5 size-4 flex-none" />
          <span>
            <strong className="font-semibold">Antes de seguir:</strong>{" "}
            {option.checks.join(" ")}
          </span>
        </div>
      )}
      {option.irreversible.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-border-strong px-3.5 py-3 text-[13px] leading-relaxed text-fg2">
          <Undo2
            aria-hidden
            className="mt-0.5 size-3.5 flex-none text-foreground"
          />
          <span>
            <strong className="font-semibold text-foreground">
              Qué no se deshace:
            </strong>{" "}
            {option.irreversible.join(" ")}
          </span>
        </div>
      )}
    </>
  )
}
