"use client"
import { useState, useTransition } from "react"
import {
  CircleCheck,
  Gavel,
  RotateCw,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react"
import { disputeFinalShipmentStatus } from "@movo/shared/src/config/dispute-resolution"
import {
  DISPUTE_OUTCOMES,
  DISPUTE_REASONING_MAX_LENGTH,
  DISPUTE_REASONING_MIN_LENGTH,
  DisputeStatus,
  type DisputeOutcome,
} from "@movo/shared/src/types/dispute"
import type {
  AdminDisputeResolution,
  AdminDisputeResolutionPreview,
} from "@movo/shared/src/types/admin-disputes"
import type { AdminBlock } from "@movo/shared/src/types/admin-shipments"
import { resolve } from "@/app/disputes/actions"
import { BlockError } from "@/components/shipments/block-error"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  AckCheck,
  ActionError,
  Consequences,
  DoneState,
} from "@/components/users/actions/fields"
import {
  FINAL_STATUS_LABEL,
  OUTCOME_LABEL,
  PAYMENT_ACTION_LABEL,
  splitLine,
} from "@/lib/disputes/format"
import {
  canConfirm,
  computeSplit,
  type PartialChoice,
} from "@/lib/disputes/resolution"
import { formatArs } from "@/lib/users/format"
import { cn } from "@/lib/utils"

interface Names {
  sender: string
  carrier: string
}

const STEPS = ["Resultado", "Impacto", "Confirmación"] as const

/**
 * Aviso del expediente que tiene que verse a lo ancho (MOVO-338): el admin es parte y no puede resolver, o la
 * disputa quedó «Procesando pago» y se reintenta con los mismos datos (el servicio es idempotente).
 */
export function ResolveNotice({
  disputeId,
  status,
  resolution,
  names,
  conflict,
}: {
  disputeId: string
  status: DisputeStatus
  resolution: AdminDisputeResolution | null
  names: Names
  /** El admin es parte del envío: ve el expediente pero no resuelve (`ADMIN_CONFLICT_OF_INTEREST`). */
  conflict: boolean
}) {
  const [done, setDone] = useState<string | null>(null)
  if (done)
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg bg-success-soft p-3 text-[13px] text-success-fg"
      >
        <CircleCheck aria-hidden className="mt-px size-4 flex-none" />
        <span>{done}</span>
      </div>
    )
  if (conflict && status !== DisputeStatus.RESOLVED)
    return (
      <div
        role="note"
        className="flex items-start gap-2.5 rounded-lg border border-dashed px-3.5 py-3 text-[13px] text-fg2"
      >
        <ShieldAlert aria-hidden className="mt-px size-4 flex-none" />
        <span>
          Sos parte de este envío, así que no podés resolver la disputa. Otro
          admin tiene que hacerlo; el expediente lo ves completo.
        </span>
      </div>
    )
  if (status === DisputeStatus.RESOLVING && resolution)
    return (
      <RetryBanner
        disputeId={disputeId}
        resolution={resolution}
        names={names}
        onDone={setDone}
      />
    )
  return null
}

/**
 * Botón «Resolver disputa» del encabezado y su diálogo de tres pasos. El formulario no decide nada: la acción de
 * pago, el monto en juego, los presets y el piso de la captura parcial salen de `resolution-preview`; `svc-admin`
 * vuelve a validar. El diálogo sigue montado al resolver para mostrar el cierre aunque el expediente ya cambie.
 */
export function ResolveAction({
  disputeId,
  status,
  preview,
  names,
  conflict,
}: {
  disputeId: string
  status: DisputeStatus
  /** `null`: no hace falta (la disputa no está abierta o el admin es parte). */
  preview: AdminBlock<AdminDisputeResolutionPreview> | null
  names: Names
  conflict: boolean
}) {
  const [open, setOpen] = useState(false)
  // La vista previa solo se pidió con la disputa abierta: se conserva al resolver para cerrar el diálogo.
  const [kept] = useState(preview)
  const block = preview ?? kept
  if (conflict || !block) return null
  if (block.error)
    return (
      <BlockError
        noun="la vista previa de la resolución"
        code={block.error.code}
        scope="expediente"
        className="flex items-center gap-3 rounded-lg bg-danger-soft px-3 py-1.5 [&>div>span:nth-child(2)]:hidden"
      />
    )
  return (
    <>
      {status === DisputeStatus.OPEN && (
        <Button type="button" onClick={() => setOpen(true)}>
          <Gavel aria-hidden />
          Resolver disputa
        </Button>
      )}
      <ResolveDialog
        open={open}
        onClose={() => setOpen(false)}
        disputeId={disputeId}
        preview={block.data}
        names={names}
      />
    </>
  )
}

/** Disputa en «Procesando pago»: el resultado ya está guardado, falta mover la plata. */
function RetryBanner({
  disputeId,
  resolution,
  names,
  onDone,
}: {
  disputeId: string
  resolution: AdminDisputeResolution
  names: Names
  onDone: (message: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const retry = () =>
    start(async () => {
      setError(null)
      const result = await resolve(disputeId, {
        outcome: resolution.outcome,
        reasoning: resolution.reasoning,
        ...(resolution.outcome === "partial" &&
          (resolution.percentage !== null
            ? { percentage: resolution.percentage }
            : { amountArs: resolution.carrierAmountArs })),
      })
      if (!result.ok) return setError(result.error)
      onDone(
        "La acción de pago salió. La disputa quedó resuelta y avisamos a las tres partes."
      )
    })
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg bg-danger-soft p-3.5 text-danger-fg"
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert aria-hidden className="mt-px size-[18px] flex-none" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            El pago de esta resolución no se confirmó
          </span>
          <span className="text-[13px]">
            {OUTCOME_LABEL[resolution.outcome]} ·{" "}
            {splitLine(
              resolution.outcome,
              names.carrier,
              names.sender,
              resolution.carrierAmountArs,
              resolution.senderAmountArs
            )}
            . {PAYMENT_ACTION_LABEL[resolution.paymentAction]}. Hasta que salga,
            la disputa no queda resuelta.
          </span>
        </div>
      </div>
      <ActionError message={error} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start bg-card text-foreground"
        disabled={pending}
        onClick={retry}
      >
        <RotateCw aria-hidden className={cn(pending && "animate-spin")} />
        {pending ? "Reintentando…" : "Reintentar con los mismos datos"}
      </Button>
    </div>
  )
}

function ResolveDialog({
  open,
  onClose,
  disputeId,
  preview,
  names,
}: {
  open: boolean
  onClose: () => void
  disputeId: string
  preview: AdminDisputeResolutionPreview
  names: Names
}) {
  const [step, setStep] = useState(1)
  const [done, setDone] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<DisputeOutcome | null>(null)
  const [choice, setChoice] = useState<PartialChoice>({
    kind: "preset",
    percentage: preview.presets[1]?.percentage ?? 50,
  })
  const [reasoning, setReasoning] = useState("")
  const [ack, setAck] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const current = outcome ?? "sender"
  const split = computeSplit(preview, current, choice, names.carrier)
  const action = preview.outcomes.find((o) => o.outcome === current)
  const final = disputeFinalShipmentStatus(current)
  const canNext =
    step === 1
      ? !!outcome && !split.error
      : step === 2
        ? true
        : canConfirm(split, reasoning, ack, DISPUTE_REASONING_MIN_LENGTH) &&
          !pending

  const close = () => {
    if (!pending) onClose()
  }
  const submit = () =>
    start(async () => {
      setError(null)
      const result = await resolve(disputeId, {
        outcome: current,
        reasoning,
        ...(current === "partial" &&
          (choice.kind === "preset"
            ? { percentage: choice.percentage }
            : { amountArs: split.carrierAmountArs })),
      })
      if (!result.ok) {
        // Con la disputa ya en «Procesando pago» el expediente muestra el reintento: se cierra el diálogo.
        if (result.paymentFailed) onClose()
        return setError(result.error)
      }
      setDone(OUTCOME_LABEL[current])
    })

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-[560px]" aria-describedby="resolve-desc">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Disputa resuelta</DialogTitle>
            </DialogHeader>
            <DoneState
              title={`Resultado: ${done.toLowerCase()}`}
              lines={[
                "Avisamos a las tres partes con el resultado y tu razonamiento.",
                "El envío pasó a su estado final y la resolución quedó en la bitácora a tu nombre.",
              ]}
              onClose={onClose}
            />
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-col gap-1">
                <DialogTitle>Resolver disputa</DialogTitle>
                <DialogDescription id="resolve-desc" className="text-[13px]">
                  Paso {step} de 3 · {STEPS[step - 1]}
                </DialogDescription>
              </div>
            </DialogHeader>
            <ol className="grid grid-cols-3 gap-2 px-5 pt-3" aria-hidden>
              {STEPS.map((name, i) => (
                <li
                  key={name}
                  className={cn(
                    "h-[3px] rounded-full",
                    i + 1 <= step ? "bg-foreground" : "bg-muted"
                  )}
                />
              ))}
            </ol>
            <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
              {step === 1 && (
                <fieldset className="flex flex-col gap-2.5">
                  <legend className="sr-only">Resultado</legend>
                  {DISPUTE_OUTCOMES.map((o) => {
                    const on = outcome === o
                    const paymentAction = preview.outcomes.find(
                      (x) => x.outcome === o
                    )?.paymentAction
                    return (
                      <label
                        key={o}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-[10px] border p-3.5",
                          on
                            ? "border-foreground bg-surface-sub"
                            : "border-border-strong"
                        )}
                      >
                        <input
                          type="radio"
                          name="outcome"
                          checked={on}
                          onChange={() => setOutcome(o)}
                          className="mt-1"
                        />
                        <span className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {o === "sender"
                              ? `A favor del emisor (${names.sender})`
                              : o === "carrier"
                                ? `A favor del transportista (${names.carrier})`
                                : "Parcial"}
                          </span>
                          <span className="text-[13px] text-fg2">
                            {paymentAction &&
                              PAYMENT_ACTION_LABEL[paymentAction]}
                            {o === "partial" &&
                              " y se reparte entre las dos partes"}
                            .
                          </span>
                        </span>
                      </label>
                    )
                  })}
                  {outcome === "partial" && (
                    <PartialPicker
                      preview={preview}
                      choice={choice}
                      onChoice={setChoice}
                      split={split}
                      names={names}
                    />
                  )}
                </fieldset>
              )}

              {step === 2 && (
                <>
                  <dl className="grid gap-3 rounded-[10px] border p-4 text-[13px] sm:grid-cols-2">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">
                        Resultado
                      </dt>
                      <dd className="font-medium">{OUTCOME_LABEL[current]}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">
                        El envío pasa a
                      </dt>
                      <dd className="font-medium">
                        {FINAL_STATUS_LABEL[final]}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5 sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">
                        Qué se ejecuta
                      </dt>
                      <dd className="font-medium">
                        {action && PAYMENT_ACTION_LABEL[action.paymentAction]}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5 sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">
                        Monto final
                      </dt>
                      <dd className="font-medium">
                        {splitLine(
                          current,
                          names.carrier,
                          names.sender,
                          split.carrierAmountArs,
                          split.senderAmountArs
                        )}
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          (de {formatArs(preview.stakeArs)} en juego)
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <Consequences
                    items={[
                      "Avisamos a las tres partes con el resultado y tu razonamiento, sin montos.",
                      current === "partial"
                        ? "Invitamos a las dos partes a calificarse entre sí. La reputación no cambia sola."
                        : "Invitamos a la parte ganadora a calificar a la otra. La reputación no cambia sola.",
                      "Se levanta el bloqueo del transportista si no le queda otra disputa abierta.",
                      "Queda en la bitácora a tu nombre.",
                    ]}
                  />
                </>
              )}

              {step === 3 && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="razonamiento"
                      className="text-sm font-medium"
                    >
                      Razonamiento
                    </label>
                    <Textarea
                      id="razonamiento"
                      value={reasoning}
                      onChange={(e) => setReasoning(e.target.value)}
                      rows={5}
                      maxLength={DISPUTE_REASONING_MAX_LENGTH}
                      disabled={pending}
                      placeholder="Explicá por qué resolvés así. Lo reciben las tres partes."
                    />
                    <span className="text-xs text-muted-foreground">
                      Obligatorio, mínimo {DISPUTE_REASONING_MIN_LENGTH}{" "}
                      caracteres. Llega a las partes y queda en la bitácora.
                    </span>
                  </div>
                  <AckCheck checked={ack} onChange={setAck} disabled={pending}>
                    Entiendo que esta resolución mueve plata y no se puede
                    deshacer: {OUTCOME_LABEL[current].toLowerCase()},{" "}
                    {splitLine(
                      current,
                      names.carrier,
                      names.sender,
                      split.carrierAmountArs,
                      split.senderAmountArs
                    )}
                    .
                  </AckCheck>
                  <ActionError message={error} />
                </>
              )}
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => (step === 1 ? close() : setStep(step - 1))}
              >
                {step === 1 ? "Cancelar" : "Atrás"}
              </Button>
              <Button
                type="button"
                disabled={!canNext}
                onClick={() => (step < 3 ? setStep(step + 1) : submit())}
              >
                {step < 3
                  ? "Continuar"
                  : pending
                    ? "Resolviendo…"
                    : "Resolver disputa"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PartialPicker({
  preview,
  choice,
  onChoice,
  split,
  names,
}: {
  preview: AdminDisputeResolutionPreview
  choice: PartialChoice
  onChoice: (choice: PartialChoice) => void
  split: ReturnType<typeof computeSplit>
  names: Names
}) {
  const chip = (on: boolean, disabled = false) =>
    cn(
      "h-[34px] rounded-full border px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45",
      on
        ? "border-foreground bg-foreground text-background"
        : "border-border-strong bg-card",
      disabled && "line-through"
    )
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border bg-surface-sub p-3.5">
      <span className="text-[13px] font-medium">
        ¿Cuánto conserva {names.carrier}?
      </span>
      <div className="flex flex-wrap gap-2">
        {preview.presets.map((p) => {
          const on =
            choice.kind === "preset" && choice.percentage === p.percentage
          return (
            <button
              key={p.percentage}
              type="button"
              aria-pressed={on}
              disabled={p.belowMinimum}
              title={
                p.belowMinimum
                  ? "No cubre la comisión de la reserva más la de Mercado Pago"
                  : undefined
              }
              onClick={() =>
                onChoice({ kind: "preset", percentage: p.percentage })
              }
              className={chip(on, p.belowMinimum)}
            >
              {p.percentage} %
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={choice.kind === "amount"}
          onClick={() => onChoice({ kind: "amount", raw: "" })}
          className={chip(choice.kind === "amount")}
        >
          Otro monto
        </button>
      </div>
      {choice.kind === "amount" && (
        <label className="flex flex-col gap-1 text-[13px]">
          <span>Monto en ARS que conserva {names.carrier}</span>
          <input
            inputMode="numeric"
            value={choice.raw}
            onChange={(e) =>
              onChoice({
                kind: "amount",
                raw: e.target.value.replace(/\D/g, ""),
              })
            }
            aria-invalid={!!split.error && !!choice.raw}
            aria-label={`Monto que conserva ${names.carrier}`}
            className="h-10 rounded-lg border border-border-strong bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-xs text-muted-foreground">
            Máximo {formatArs(preview.stakeArs - 1)}.
            {preview.minimumPartialArs !== null &&
              ` Mínimo ${formatArs(preview.minimumPartialArs)}.`}
          </span>
        </label>
      )}
      {split.error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {split.error}
        </p>
      ) : (
        <p className="text-[13px] text-fg2">
          {names.carrier} conserva {formatArs(split.carrierAmountArs)} ·{" "}
          {names.sender} {formatArs(split.senderAmountArs)}.
        </p>
      )}
    </div>
  )
}
