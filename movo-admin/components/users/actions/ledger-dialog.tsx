"use client"
import { useRef, useState, useTransition } from "react"
import { ArrowDownLeft, ArrowRight, ArrowUpRight } from "lucide-react"
import type { AdminLedgerAdjustmentResult } from "@movo/shared/src/types/admin-users"
import { adjustLedger } from "@/app/users/[id]/account-actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatArs, formatSignedArs } from "@/lib/users/format"
import { describeBalance, parseAmountArs } from "@/lib/users/money"
import { cn } from "@/lib/utils"
import { stateOf, useFicha } from "../ficha-status"
import { Eyebrow, StatusPill } from "../ui"
import {
  AckCheck,
  ActionError,
  Consequences,
  DoneState,
  ReasonField,
} from "./fields"

type Direction = "owes" | "credit"

const QUICK_AMOUNTS = [500, 1000, 2000, 5000]

const toneOf = (balance: number) =>
  balance > 0 ? "text-warn-fg" : balance < 0 ? "text-success-fg" : ""

/** Número grande del saldo (sin signo: el estado lo dice la pastilla). */
function BalanceHero({
  fullName,
  balance,
  status,
}: {
  fullName: string
  balance: number | null
  status: "loading" | "ready" | "error"
}) {
  const pill =
    balance === null
      ? null
      : balance > 0
        ? ({ label: "Debe", tone: "warning" } as const)
        : balance < 0
          ? ({ label: "A favor", tone: "success" } as const)
          : ({ label: "Al día", tone: "neutral" } as const)
  return (
    <div className="mv-grid-flat flex flex-col gap-2 rounded-xl border px-4 py-3.5">
      <Eyebrow>Saldo actual · {fullName}</Eyebrow>
      {balance !== null && pill ? (
        <div className="flex items-end justify-between gap-3">
          <span
            className={cn(
              "text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums",
              toneOf(balance)
            )}
          >
            {formatArs(balance)}
          </span>
          <StatusPill pill={pill} dot />
        </div>
      ) : (
        <span className="text-sm text-fg2">
          {status === "error"
            ? "No pudimos leer la cuenta corriente."
            : "Cargando la cuenta corriente…"}
        </span>
      )}
    </div>
  )
}

const DIRECTIONS: {
  value: Direction
  title: string
  hint: string
  icon: typeof ArrowUpRight
  on: string
  badge: string
}[] = [
  {
    value: "owes",
    title: "Debe más",
    hint: "Un cobro que faltó",
    icon: ArrowUpRight,
    on: "border-dot-warning bg-warn-soft",
    badge: "bg-warn-soft text-warn-fg",
  },
  {
    value: "credit",
    title: "Debe menos",
    hint: "Algo cobrado de más",
    icon: ArrowDownLeft,
    on: "border-dot-success bg-success-soft",
    badge: "bg-success-soft text-success-fg",
  },
]

function DirectionCards({
  value,
  onChange,
}: {
  value: Direction
  onChange: (value: Direction) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Sentido del ajuste"
      className="grid grid-cols-2 gap-2.5"
    >
      {DIRECTIONS.map((d) => {
        const on = d.value === value
        const Icon = d.icon
        return (
          <button
            key={d.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(d.value)}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              on ? d.on : "border-border bg-card hover:bg-muted"
            )}
          >
            <span
              className={cn(
                "flex size-8 flex-none items-center justify-center rounded-lg",
                on ? d.badge : "bg-muted text-muted-foreground"
              )}
            >
              <Icon aria-hidden className="size-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{d.title}</span>
              <span className="text-xs text-muted-foreground">{d.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Antes → después, con el después resaltado según quede debiendo, a favor o al día. */
function BalanceShift({ before, after }: { before: number; after: number }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Antes
        </span>
        <span className="text-sm text-fg2 tabular-nums">
          {describeBalance(before, formatArs)}
        </span>
      </div>
      <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Después
        </span>
        <span
          className={cn("text-lg font-semibold tabular-nums", toneOf(after))}
        >
          {describeBalance(after, formatArs)}
        </span>
      </div>
    </div>
  )
}

export function LedgerDialog({
  open,
  onClose,
  userId,
  fullName,
}: {
  open: boolean
  onClose: () => void
  userId: string
  fullName: string
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajustar el saldo</DialogTitle>
        </DialogHeader>
        <LedgerForm userId={userId} fullName={fullName} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function LedgerForm({
  userId,
  fullName,
  onClose,
}: {
  userId: string
  fullName: string
  onClose: () => void
}) {
  const cuenta = stateOf(useFicha(), "cuenta")
  const balance = cuenta.status === "ready" ? (cuenta.balanceArs ?? null) : null
  const [step, setStep] = useState<"edit" | "confirm" | "done">("edit")
  const [direction, setDirection] = useState<Direction>("owes")
  const [raw, setRaw] = useState("")
  const [reason, setReason] = useState("")
  const [ack, setAck] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AdminLedgerAdjustmentResult | null>(null)
  const [pending, start] = useTransition()
  // Un doble envío del mismo ajuste no duplica el movimiento: la clave dura mientras el diálogo
  // está abierto y solo se renueva cuando el rechazo fue definitivo (ver `submit`).
  const key = useRef<string>(crypto.randomUUID())

  const amount = parseAmountArs(raw)
  const signed =
    amount === null ? null : direction === "owes" ? amount : -amount
  const after =
    balance !== null && signed !== null
      ? Math.round((balance + signed) * 100) / 100
      : null
  const invalid = touched && raw.trim() !== "" && amount === null
  const canReview = balance !== null && signed !== null && reason.trim() !== ""

  const submit = () =>
    start(async () => {
      if (signed === null) return
      setError(null)
      const response = await adjustLedger(userId, {
        amountArs: signed,
        reason,
        idempotencyKey: key.current,
      })
      if (!response.ok) {
        // Si el servicio no respondió, el ajuste pudo haberse aplicado: se reintenta con la misma
        // clave. Ante un rechazo definitivo no hay nada aplicado y se puede empezar con una nueva.
        if (!response.unconfirmed) key.current = crypto.randomUUID()
        return setError(response.error)
      }
      setResult(response.data)
      setStep("done")
    })

  if (step === "done" && result)
    return (
      <DoneState
        title="Ajuste registrado"
        lines={[
          `${formatSignedArs(result.entry.amountArs)} en la cuenta corriente de ${fullName}.`,
          `Saldo ahora: ${describeBalance(result.balanceArs, formatArs)}.`,
          "Quedó en la bitácora.",
        ]}
        onClose={onClose}
      />
    )

  if (
    step === "confirm" &&
    signed !== null &&
    balance !== null &&
    after !== null
  )
    return (
      <>
        <DialogBody>
          <div className="overflow-hidden rounded-xl border">
            <div
              className={cn(
                "h-1.5",
                signed > 0 ? "bg-dot-warning" : "bg-dot-success"
              )}
            />
            <div className="flex flex-col items-center gap-1 px-4 py-4 text-center">
              <Eyebrow>Ajuste manual · {fullName}</Eyebrow>
              <span
                className={cn(
                  "text-[40px] leading-tight font-semibold tracking-[-0.03em] tabular-nums",
                  signed > 0 ? "text-warn-fg" : "text-success-fg"
                )}
              >
                {formatSignedArs(signed)}
              </span>
              <span className="line-clamp-2 max-w-[360px] text-xs text-muted-foreground">
                {reason.trim()}
              </span>
            </div>
            <div className="border-t border-dashed bg-surface-sub px-4 py-3.5">
              <BalanceShift before={balance} after={after} />
            </div>
          </div>
          <Consequences
            items={[
              "Queda como un movimiento «Ajuste manual» en la cuenta corriente de la persona.",
              signed > 0
                ? "Si queda debiendo, se descuenta en su próximo cobro o lo puede pagar desde la app."
                : "Baja lo que debe; si pasa a favor, se descuenta de lo que deba más adelante.",
              "No se edita ni se borra: un error se corrige con otro ajuste de signo contrario.",
              "Queda en la bitácora con tu nombre y el motivo.",
            ]}
          />
          <AckCheck checked={ack} onChange={setAck} disabled={pending}>
            Confirmo que el monto y el sentido del ajuste son correctos.
          </AckCheck>
          <ActionError message={error} />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null)
              setAck(false)
              setStep("edit")
            }}
          >
            Volver
          </Button>
          <Button type="button" disabled={!ack || pending} onClick={submit}>
            {pending ? "Registrando…" : "Registrar ajuste"}
          </Button>
        </DialogFooter>
      </>
    )

  const accent =
    direction === "owes"
      ? "bg-warn-soft text-warn-fg"
      : "bg-success-soft text-success-fg"
  return (
    <>
      <DialogBody>
        <BalanceHero
          fullName={fullName}
          balance={balance}
          status={cuenta.status}
        />
        <DirectionCards value={direction} onChange={setDirection} />
        <div className="flex flex-col gap-2">
          <label htmlFor="ledger-amount" className="text-[13px] font-medium">
            Monto (ARS)
          </label>
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-transparent px-3 py-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
              invalid && "border-destructive"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex size-9 flex-none items-center justify-center rounded-full text-lg font-semibold",
                accent
              )}
            >
              {direction === "owes" ? "+" : "−"}
            </span>
            <span aria-hidden className="text-2xl text-muted-foreground">
              $
            </span>
            <input
              id="ledger-amount"
              value={raw}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="0"
              aria-invalid={invalid}
              onBlur={() => setTouched(true)}
              onChange={(e) => setRaw(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[32px] leading-none font-semibold tracking-[-0.02em] tabular-nums outline-none placeholder:text-muted-foreground/40"
            />
            <span className="text-xs font-medium text-muted-foreground">
              ARS
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_AMOUNTS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRaw(value.toLocaleString("es-AR"))}
                className="h-7 rounded-full border px-2.5 text-xs font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                ${value.toLocaleString("es-AR")}
              </button>
            ))}
          </div>
          <span
            className="min-h-4 text-xs text-muted-foreground"
            role={invalid ? "alert" : undefined}
          >
            {invalid
              ? "Ingresá un monto mayor a cero, con hasta dos decimales."
              : "Siempre en positivo: el sentido lo da la opción de arriba."}
          </span>
        </div>
        <div className="rounded-xl border border-dashed bg-surface-sub px-4 py-3">
          {balance !== null && after !== null ? (
            <BalanceShift before={balance} after={after} />
          ) : (
            <span className="text-[13px] text-muted-foreground">
              Ingresá un monto para ver cómo queda el saldo.
            </span>
          )}
        </div>
        <ReasonField
          id="ledger-reason"
          value={reason}
          onChange={setReason}
          placeholder="Por qué se ajusta (ej. penalidad cobrada de más en el envío A1B2C3D4)"
        />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={!canReview}
          onClick={() => setStep("confirm")}
        >
          Revisar ajuste
        </Button>
      </DialogFooter>
    </>
  )
}
