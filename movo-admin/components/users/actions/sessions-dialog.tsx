"use client"
import { useState, useTransition } from "react"
import { revokeSessions } from "@/app/users/[id]/account-actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ActionError, Consequences, DoneState, ReasonField } from "./fields"

export function SessionsDialog({
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
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Cerrar todas las sesiones</DialogTitle>
        </DialogHeader>
        <SessionsForm userId={userId} fullName={fullName} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function SessionsForm({
  userId,
  fullName,
  onClose,
}: {
  userId: string
  fullName: string
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [revoked, setRevoked] = useState<number | null>(null)
  const [pending, start] = useTransition()

  const submit = () =>
    start(async () => {
      setError(null)
      const result = await revokeSessions(userId, reason)
      if (!result.ok) return setError(result.error)
      setRevoked(result.data.revokedRefreshTokens)
    })

  if (revoked !== null)
    return (
      <DoneState
        title="Sesiones cerradas"
        lines={[
          `${fullName} tiene que volver a iniciar sesión en la app.`,
          "Quedó en la bitácora.",
        ]}
        onClose={onClose}
      />
    )
  return (
    <>
      <DialogBody>
        <p className="text-sm text-fg2">
          Útil si sospechás que alguien más usa la cuenta de{" "}
          <strong className="font-medium text-foreground">{fullName}</strong> o
          si lo pide soporte.
        </p>
        <Consequences
          items={[
            "Se cierran las sesiones de la app en todos sus dispositivos, incluso con un acceso ya emitido.",
            "Puede volver a entrar cuando quiera: esto no bloquea la cuenta (para eso están las sanciones).",
            "Si tiene el rol admin, también se cierran sus sesiones del panel.",
          ]}
        />
        <ReasonField
          id="sessions-reason"
          value={reason}
          onChange={setReason}
          disabled={pending}
          autoFocus
          placeholder="Por qué se cierran (ej. reportó el celular como robado)"
        />
        <ActionError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending || reason.trim().length === 0}
          onClick={submit}
        >
          {pending ? "Cerrando…" : "Cerrar sesiones"}
        </Button>
      </DialogFooter>
    </>
  )
}
