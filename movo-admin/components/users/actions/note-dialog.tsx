"use client"
import { useState, useTransition } from "react"
import { ADMIN_NOTE_MAX_LENGTH } from "@movo/shared/src/types/admin-users"
import { addNote } from "@/app/users/[id]/account-actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ActionError } from "./fields"
import { PostitPin } from "./postit"

export function NoteDialog({
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
          <DialogTitle>Nota interna</DialogTitle>
        </DialogHeader>
        <NoteForm userId={userId} fullName={fullName} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function NoteForm({
  userId,
  fullName,
  onClose,
}: {
  userId: string
  fullName: string
  onClose: () => void
}) {
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const submit = () =>
    start(async () => {
      setError(null)
      const result = await addNote(userId, body)
      if (!result.ok) return setError(result.error)
      onClose()
    })

  return (
    <>
      <DialogBody>
        <p className="text-sm text-fg2">
          Contexto para el resto del equipo sobre{" "}
          <strong className="font-medium text-foreground">{fullName}</strong>.{" "}
          La persona no la ve y no se puede editar ni borrar después.
        </p>
        <div className="mv-postit mt-1.5 rounded-[3px] px-5 pt-6 pb-5">
          <PostitPin />
          <label htmlFor="note-body" className="sr-only">
            Nota
          </label>
          <textarea
            id="note-body"
            value={body}
            maxLength={ADMIN_NOTE_MAX_LENGTH}
            disabled={pending}
            autoFocus
            placeholder="Qué pasó, qué se habló, qué falta…"
            onChange={(e) => setBody(e.target.value)}
            className="mv-postit-lines block min-h-[168px] w-full resize-none bg-transparent text-[15px] leading-[28px] outline-none placeholder:text-[var(--postit-ink)]/45"
          />
          <div className="mt-2 flex items-center justify-between gap-3 pr-6 text-xs text-[var(--postit-ink)]/70">
            <span>La ven todos los admins, con tu nombre y la fecha.</span>
            <span className="tabular-nums">
              {body.length}/{ADMIN_NOTE_MAX_LENGTH}
            </span>
          </div>
        </div>
        <ActionError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={pending || body.trim().length === 0}
          onClick={submit}
        >
          {pending ? "Guardando…" : "Guardar nota"}
        </Button>
      </DialogFooter>
    </>
  )
}
