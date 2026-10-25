"use client"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ActionError } from "@/components/users/actions/fields"
import type { ShipmentStatusValue } from "@/lib/shipments/format"
import { cn } from "@/lib/utils"
import { statusLabel } from "./copy"
import { StepConfirm } from "./step-confirm"
import { StepImpact } from "./step-impact"
import { StepSelect } from "./step-select"
import { useStatusChange, type StatusChangeDone } from "./use-status-change"

const STEPS = ["Nuevo estado", "Impacto", "Confirmación"] as const

/**
 * Modal de cambio de estado de un envío, en tres pasos: elegir, ver el impacto y confirmar (MOVO-333). Qué se puede
 * elegir, con qué riesgo y qué se exige sale de `status-options`; el foco queda atrapado, Escape y el fondo cierran
 * salvo mientras se está aplicando, y nada de lo escrito se pierde ante un error.
 */
export function StatusChangeDialog({
  shipmentId,
  displayCode,
  currentStatus,
  onOpenChange,
  onDone,
}: {
  shipmentId: string
  /** El código que muestra el encabezado, sin `#` (`MOVO-12345`). */
  displayCode: string
  currentStatus: ShipmentStatusValue
  onOpenChange: (open: boolean) => void
  onDone: (done: StatusChangeDone) => void
}) {
  const c = useStatusChange({ shipmentId, onDone })
  const { state, option } = c
  const current = state.options?.current ?? currentStatus
  const danger =
    state.step === 3 &&
    !!option &&
    (option.kind === "forced" || option.risk === "critical")
  const toLabel = state.target ? statusLabel(state.target) : ""
  const nextLabel =
    state.step < 3
      ? "Continuar"
      : option && state.target
        ? `${option.kind === "forced" ? "Forzar" : "Pasar"} a ${toLabel}`
        : "Confirmar"
  const ready = !!state.options && !state.loading

  return (
    <Dialog
      open
      // Mientras se aplica no se cierra ni con Escape ni con el fondo ni con la X.
      onOpenChange={(next) => {
        if (!next && c.busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100svh-48px)] max-w-[660px] overflow-hidden"
      >
        <DialogHeader className="flex-col gap-4 border-b px-5 pb-4">
          <div className="flex w-full items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <DialogTitle>Cambiar estado</DialogTitle>
              <span className="text-[13px] text-fg2">
                <span className="font-mono">#{displayCode}</span> · ahora está{" "}
                <strong className="font-medium text-foreground">
                  {statusLabel(current)}
                </strong>
              </span>
            </div>
          </div>
          <ol className="grid w-full grid-cols-3 gap-2">
            {STEPS.map((label, i) => {
              const n = i + 1
              const reached = n <= state.step
              return (
                <li
                  key={label}
                  aria-current={n === state.step ? "step" : undefined}
                  className="flex flex-col gap-1.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-[3px] rounded-full",
                      reached ? "bg-foreground" : "bg-muted"
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs font-medium",
                      reached ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {n}. {label}
                  </span>
                </li>
              )
            })}
          </ol>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-auto pt-5">
          {state.loading && !state.options && (
            <p role="status" className="text-[13px] text-fg2">
              Cargando las opciones…
            </p>
          )}
          {state.loadError && (
            <>
              <ActionError message={state.loadError} />
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => void c.reload()}
              >
                Reintentar
              </Button>
            </>
          )}
          {ready && <ActionError message={state.error?.error ?? null} />}
          {ready && state.step === 1 && state.options && (
            <StepSelect
              options={state.options}
              target={state.target}
              showForced={state.showForced}
              onPick={c.pick}
              onToggleForced={c.toggleForced}
              disabled={c.busy}
            />
          )}
          {ready &&
            state.step === 2 &&
            option &&
            state.target &&
            state.options && (
              <StepImpact
                from={state.options.current}
                to={state.target}
                option={option}
              />
            )}
          {ready &&
            state.step === 3 &&
            option &&
            state.target &&
            state.options && (
              <StepConfirm
                shipmentCode={state.options.code}
                toLabel={toLabel}
                option={option}
                reason={state.reason}
                typed={state.typed}
                typedOk={c.typedOk}
                code={state.code}
                ack={state.ack}
                challenge={state.challenge}
                resendAt={state.resendAt}
                verified={!!state.stepUpToken}
                sending={state.sendingCode}
                disabled={state.submitting}
                onReason={c.setReason}
                onTyped={c.setTyped}
                onCode={c.setCode}
                onAck={c.setAck}
                onSendCode={() => void c.sendCode()}
              />
            )}
        </DialogBody>

        <DialogFooter className="items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Paso {state.step} de 3
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={c.busy}
              onClick={() =>
                state.step === 1 ? onOpenChange(false) : c.back()
              }
            >
              {state.step === 1 ? "Cancelar" : "Atrás"}
            </Button>
            <Button
              type="button"
              disabled={!ready || !c.canNext || c.busy}
              onClick={c.next}
              className={cn(
                "min-w-[150px]",
                danger &&
                  "bg-[var(--danger-solid)] text-white hover:bg-[var(--danger-solid-hover)]"
              )}
            >
              {state.submitting ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Aplicando…
                </>
              ) : (
                nextLabel
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
