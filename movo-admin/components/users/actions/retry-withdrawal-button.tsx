"use client"
import { useState, useTransition } from "react"
import { RotateCw } from "lucide-react"
import { retrySanctionWithdrawal } from "@/app/users/[id]/account-actions"
import { Button } from "@/components/ui/button"
import { describeWithdrawn } from "@/lib/users/sanctions"

/**
 * Reintenta el retiro de la actividad abierta de una sanción vigente (MOVO-299 AC2). Es idempotente
 * en `svc-shipments`: solo toma lo que sigue abierto. La server action refresca la ficha al terminar.
 */
export function RetryWithdrawalButton({
  userId,
  sanctionId,
}: {
  userId: string
  sanctionId: string
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  )
  const [pending, start] = useTransition()

  const retry = () =>
    start(async () => {
      setMessage(null)
      const response = await retrySanctionWithdrawal(userId, sanctionId)
      if (!response.ok) return setMessage({ ok: false, text: response.error })
      const w = response.data
      setMessage(
        w.status === "complete" && w.result
          ? { ok: true, text: `Este intento: ${describeWithdrawn(w.result)}` }
          : {
              ok: false,
              text: "Todavía quedó algo sin retirar. Podés volver a intentarlo.",
            }
      )
    })

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={retry}
      >
        <RotateCw
          aria-hidden
          className={pending ? "animate-spin" : undefined}
        />
        {pending ? "Reintentando…" : "Reintentar el retiro"}
      </Button>
      {message && (
        <span
          role={message.ok ? "status" : "alert"}
          className={
            message.ok ? "text-xs text-success-fg" : "text-xs text-danger-fg"
          }
        >
          {message.text}
        </span>
      )}
    </div>
  )
}
