"use client"
import { useState, useTransition } from "react"
import { EyeOff, NotebookPen, Plus, RotateCw } from "lucide-react"
import { DISPUTE_NOTE_MAX_LENGTH } from "@movo/shared/src/types/dispute"
import type {
  AdminDisputeNote,
  AdminDisputeNotePage,
} from "@movo/shared/src/types/admin-disputes"
import { addNote, loadMoreNotes } from "@/app/disputes/actions"
import { Button } from "@/components/ui/button"
import { ActionError } from "@/components/users/actions/fields"
import { PostitPin } from "@/components/users/actions/postit"
import { IconTile } from "@/components/users/ui"
import { formatDateTime } from "@/lib/users/format"
import { cn } from "@/lib/utils"

/**
 * Notas internas de la disputa, de la más reciente a la más vieja. Solo se agregan: no se editan ni se
 * borran. Las ven los admins; las partes nunca (la leyenda lo dice al lado del campo).
 */
export function NotesCard({
  disputeId,
  initial,
  conflict,
}: {
  disputeId: string
  initial: AdminDisputeNotePage
  /** El admin es parte del envío: ve las notas pero no puede escribir. */
  conflict: boolean
}) {
  const [items, setItems] = useState<AdminDisputeNote[]>(initial.items)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [moreFailed, setMoreFailed] = useState<number | null>(null)
  const [saving, startSave] = useTransition()
  const [loadingMore, startMore] = useTransition()

  const save = () =>
    startSave(async () => {
      setError(null)
      const result = await addNote(disputeId, draft)
      if (!result.ok) return setError(result.error)
      setItems((prev) => [result.data, ...prev])
      setDraft("")
    })
  const more = () =>
    startMore(async () => {
      if (!nextCursor) return
      const result = await loadMoreNotes(disputeId, nextCursor)
      if (!result.ok) return setMoreFailed(result.status ?? 500)
      setMoreFailed(null)
      setItems((prev) => [...prev, ...result.data.items])
      setNextCursor(result.data.nextCursor)
    })

  return (
    <section
      aria-labelledby="notas-title"
      className="flex flex-col gap-3.5 rounded-[10px] border bg-card p-[18px]"
    >
      <header className="flex items-center gap-2.5">
        <IconTile>
          <NotebookPen aria-hidden />
        </IconTile>
        <h2 id="notas-title" className="text-[15px] font-semibold">
          Notas internas
        </h2>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <EyeOff aria-hidden className="size-3.5" />
          No visibles para los usuarios
        </span>
      </header>

      {conflict ? (
        <p className="rounded-lg border border-dashed px-3.5 py-3 text-[13px] text-fg2">
          Sos parte de este envío: podés leer las notas, pero no agregar nuevas.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="mv-postit rounded-[3px] px-4 pt-6 pb-3.5">
            <PostitPin />
            <label htmlFor="nota-nueva" className="sr-only">
              Nueva nota interna
            </label>
            <textarea
              id="nota-nueva"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={DISPUTE_NOTE_MAX_LENGTH}
              rows={3}
              disabled={saving}
              placeholder="Qué pasó, qué se habló, qué falta…"
              className="mv-postit-lines block min-h-[112px] w-full resize-none bg-transparent text-[15px] leading-[28px] outline-none placeholder:text-[var(--postit-ink)]/45"
            />
            <div className="mt-1.5 flex items-center justify-between gap-3 pr-6 text-xs text-[var(--postit-ink)]/70">
              <span>La ven todos los admins, con tu nombre.</span>
              <span className="tabular-nums">
                {draft.length}/{DISPUTE_NOTE_MAX_LENGTH}
              </span>
            </div>
          </div>
          <ActionError message={error} />
          <Button
            type="button"
            size="sm"
            className="self-end"
            disabled={saving || draft.trim().length === 0}
            onClick={save}
          >
            <Plus aria-hidden />
            {saving ? "Agregando…" : "Agregar nota"}
          </Button>
        </div>
      )}

      {items.length === 0 ? (
        <p className="text-[13px] text-fg2">Todavía no hay notas.</p>
      ) : (
        <ul className="flex flex-col gap-5 pt-2">
          {items.map((note, i) => (
            <li
              key={note.id}
              className={cn(
                "mv-postit flex flex-col gap-3 rounded-[3px] px-4 pt-5 pb-4",
                i % 2 === 0 ? "-rotate-[0.6deg]" : "rotate-[0.5deg]"
              )}
            >
              <PostitPin />
              <p className="text-[14px] leading-[1.55] text-pretty whitespace-pre-wrap">
                {note.body}
              </p>
              <span className="pr-6 text-xs text-[var(--postit-ink)]/70">
                {note.adminName ?? "Admin"} · {formatDateTime(note.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex items-center gap-3">
          <span
            className="flex-1 text-[13px] text-muted-foreground"
            role={moreFailed ? "alert" : undefined}
          >
            {moreFailed
              ? `No pudimos cargar más notas (${moreFailed}). El resto del expediente no se ve afectado.`
              : "Hay más notas."}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={more}
          >
            {moreFailed && <RotateCw aria-hidden />}
            {loadingMore ? "Cargando…" : moreFailed ? "Reintentar" : "Ver más"}
          </Button>
        </div>
      )}
    </section>
  )
}
