"use client"
import { useEffect, useState } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import {
  FORCE_STATUS_REASON_MAX_LENGTH,
  FORCE_STATUS_REASON_MIN_LENGTH,
  type ShipmentStatusOption,
  type StepUpChallenge,
} from "@movo/shared/src/types/admin-shipments"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { AckCheck } from "@/components/users/actions/fields"

/** Segundos que faltan para poder pedir otro código; se actualiza cada segundo mientras corre. */
function useCountdown(until: number): number {
  const [wait, setWait] = useState(0)
  useEffect(() => {
    const tick = () =>
      setWait(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    // Todo en callbacks: el primer valor llega apenas arranca el efecto, no durante el render.
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [until])
  return wait
}

/** Segundo factor: se pide un código por email y se escribe acá, o ya hay un token verificado de un intento anterior. */
function OtpBlock({
  challenge,
  resendAt,
  verified,
  code,
  onCode,
  onSend,
  sending,
  disabled,
}: {
  challenge: StepUpChallenge | null
  resendAt: number
  verified: boolean
  code: string
  onCode: (code: string) => void
  onSend: () => void
  sending: boolean
  disabled: boolean
}) {
  const wait = useCountdown(resendAt)
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-surface-sub p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="flex size-7 flex-none items-center justify-center rounded-md bg-foreground text-background">
          <KeyRound aria-hidden className="size-3.5" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Verificá que sos vos</span>
          <span className="text-[13px] leading-snug text-pretty text-fg2">
            Los cambios forzados o de riesgo crítico piden un código nuevo.{" "}
            {challenge ? (
              <>
                Te lo mandamos a{" "}
                <span className="font-mono text-xs text-foreground">
                  {challenge.maskedEmail}
                </span>
                . Vale {Math.round(challenge.expiresInSeconds / 60)} minutos.
              </>
            ) : (
              "Te lo mandamos al email de tu cuenta."
            )}
          </span>
        </div>
      </div>
      {verified ? (
        <span role="status" className="text-[13px] font-medium text-success-fg">
          Código verificado.
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <InputOTP
            id="status-change-otp"
            maxLength={6}
            pattern="^[0-9]*$"
            pasteTransformer={(value) => value.replace(/\s/g, "")}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Código de 6 dígitos"
            value={code}
            onChange={onCode}
            disabled={disabled || !challenge}
          >
            <InputOTPGroup>
              {Array.from({ length: 6 }, (_, i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSend}
            disabled={disabled || sending || wait > 0}
          >
            {sending && <Loader2 aria-hidden className="animate-spin" />}
            {challenge
              ? wait > 0
                ? `Reenviar en ${wait} s`
                : "Reenviar código"
              : "Enviar código"}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Paso 3: motivo, código del envío (riesgo alto o crítico), código por email (forzado o crítico) y el check final. */
export function StepConfirm({
  shipmentCode,
  toLabel,
  option,
  reason,
  typed,
  typedOk,
  code,
  ack,
  challenge,
  resendAt,
  verified,
  sending,
  disabled,
  onReason,
  onTyped,
  onCode,
  onAck,
  onSendCode,
}: {
  shipmentCode: string
  toLabel: string
  option: ShipmentStatusOption
  reason: string
  typed: string
  typedOk: boolean
  code: string
  ack: boolean
  challenge: StepUpChallenge | null
  resendAt: number
  verified: boolean
  sending: boolean
  disabled: boolean
  onReason: (value: string) => void
  onTyped: (value: string) => void
  onCode: (value: string) => void
  onAck: (value: boolean) => void
  onSendCode: () => void
}) {
  const length = reason.trim().length
  const reasonOk = length >= FORCE_STATUS_REASON_MIN_LENGTH
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between gap-3 text-[13px]">
          <label htmlFor="status-change-reason" className="font-medium">
            Motivo
          </label>
          <span
            aria-live="polite"
            className={cn(
              "tabular-nums",
              reasonOk ? "text-success-fg" : "text-muted-foreground"
            )}
          >
            {reasonOk
              ? `${length} caracteres`
              : `${length} / ${FORCE_STATUS_REASON_MIN_LENGTH} mínimo`}
          </span>
        </div>
        <Textarea
          id="status-change-reason"
          rows={3}
          value={reason}
          maxLength={FORCE_STATUS_REASON_MAX_LENGTH}
          disabled={disabled}
          onChange={(e) => onReason(e.target.value)}
          placeholder="Ej.: el receptor confirmó por teléfono que recibió el paquete; el QR no leía por un problema de la cámara."
          className="min-h-[88px]"
        />
        <span className="text-xs text-muted-foreground">
          Queda en la línea de tiempo del envío y en la bitácora. Las partes no
          lo ven.
        </span>
      </div>

      {option.requiresTypedCode && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="status-change-typed"
            className="text-[13px] font-medium"
          >
            Escribí{" "}
            <span className="rounded bg-muted px-1.5 py-px font-mono">
              {shipmentCode}
            </span>{" "}
            para confirmar
          </label>
          <Input
            id="status-change-typed"
            value={typed}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={typed !== "" && !typedOk}
            onChange={(e) => onTyped(e.target.value)}
            className={cn(
              "h-10 font-mono font-medium tracking-[0.02em]",
              typedOk ? "border-success-fg" : typed !== "" && "border-danger-fg"
            )}
          />
        </div>
      )}

      {option.requiresStepUp && (
        <OtpBlock
          challenge={challenge}
          resendAt={resendAt}
          verified={verified}
          code={code}
          onCode={onCode}
          onSend={onSendCode}
          sending={sending}
          disabled={disabled}
        />
      )}

      <AckCheck checked={ack} onChange={onAck} disabled={disabled}>
        Entiendo lo que implica pasar #{shipmentCode} a {toLabel}
        {option.kind === "forced" ? " fuera del flujo" : ""} y que la acción
        queda a mi nombre.
      </AckCheck>
    </>
  )
}
