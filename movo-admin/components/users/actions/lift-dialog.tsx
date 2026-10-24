"use client"
import { useState, useTransition } from "react"
import { ACCOUNT_SANCTION_REASON_MAX_LENGTH } from "@movo/shared/src/types/account-sanctions"
import type { AdminUserSanction } from "@movo/shared/src/types/admin-users"
import { liftSanction } from "@/app/users/[id]/account-actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/users/format"
import { ActionError, Consequences, DoneState, ReasonField } from "./fields"

/** Levantar la sanción vigente (MOVO-299 AC6): solo el motivo. */
export function LiftDialog({
  sanction,
  onClose,
  userId,
  fullName,
}: {
  /** `null` cierra el diálogo. */
  sanction: AdminUserSanction | null
  onClose: () => void
  userId: string
  fullName: string
}) {
  return (
    <Dialog
      open={sanction !== null}
      onOpenChange={(next) => !next && onClose()}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Levantar la sanción</DialogTitle>
        </DialogHeader>
        {sanction && (
          <LiftForm
            sanction={sanction}
            userId={userId}
            fullName={fullName}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function LiftForm({
  sanction,
  userId,
  fullName,
  onClose,
}: {
  sanction: AdminUserSanction
  userId: string
  fullName: string
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()
  const suspension = sanction.type === "suspension"

  const submit = () =>
    start(async () => {
      setError(null)
      const result = await liftSanction(userId, sanction.id, reason)
      if (!result.ok) return setError(result.error)
      setDone(true)
    })

  if (done)
    return (
      <DoneState
        title="Sanción levantada"
        lines={[
          `${fullName} vuelve a operar normalmente.`,
          "Quedó en la bitácora.",
        ]}
        onClose={onClose}
      />
    )
  return (
    <>
      <DialogBody>
        <p className="text-sm text-fg2">
          {suspension ? "Suspensión" : "Inhabilitación"} aplicada el{" "}
          {formatDate(sanction.startedAt)}
          {sanction.appliedByName ? ` por ${sanction.appliedByName}` : ""}:{" "}
          <span className="text-foreground">«{sanction.reason}»</span>
        </p>
        <Consequences
          items={[
            suspension
              ? "Puede volver a publicar, ofertar y declarar viajes en su próxima acción."
              : "Puede volver a iniciar sesión.",
            "Lo que se retiró al sancionar no vuelve: las publicaciones canceladas y las ofertas retiradas quedan así.",
          ]}
        />
        <ReasonField
          id="lift-reason"
          value={reason}
          onChange={setReason}
          disabled={pending}
          autoFocus
          max={ACCOUNT_SANCTION_REASON_MAX_LENGTH}
          placeholder="Por qué se levanta (ej. se revisó el reclamo y no correspondía)"
        />
        <ActionError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={pending || reason.trim().length === 0}
          onClick={submit}
        >
          {pending ? "Levantando…" : "Levantar sanción"}
        </Button>
      </DialogFooter>
    </>
  )
}
