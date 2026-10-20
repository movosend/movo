"use client"
import { useState, useTransition } from "react"
import { NotebookPen, Plus } from "lucide-react"
import type { AdminUserNotePage } from "@movo/shared/src/types/admin-users"
import { loadNotesMore } from "@/app/users/[id]/account-actions"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/users/format"
import { NoteDialog } from "../actions/note-dialog"
import { PostitPin } from "../actions/postit"
import { cn } from "@/lib/utils"
import { ReportSection } from "../ficha-status"
import { MoreRow } from "../more-row"
import { SectionEmpty, SectionShell } from "../ui"

/** Notas internas de la cuenta, de la más reciente a la más vieja. Solo se agregan: no se editan ni se borran. */
export function NotesPanel({
  userId,
  fullName,
  initial,
}: {
  userId: string
  /** Para el diálogo de nueva nota. */
  fullName: string
  initial: AdminUserNotePage
}) {
  const [items, setItems] = useState(initial.items)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [failed, setFailed] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [pending, start] = useTransition()
  const more = () =>
    start(async () => {
      if (!nextCursor) return
      const result = await loadNotesMore(userId, nextCursor)
      if (!result.ok) return setFailed(result.status)
      setFailed(null)
      setItems((prev) => [...prev, ...result.data.items])
      setNextCursor(result.data.nextCursor)
    })
  return (
    <SectionShell
      id="notas"
      aside={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden />
          Agregar nota
        </Button>
      }
    >
      <ReportSection id="notas" status="ready" count={items.length} />
      {items.length > 0 && (
        <div className="grid gap-5 px-[18px] pt-6 pb-5 min-[720px]:grid-cols-2">
          {items.map((note, i) => (
            <article
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
                {note.adminName} · {formatDateTime(note.createdAt)}
              </span>
            </article>
          ))}
        </div>
      )}
      {items.length === 0 && (
        <SectionEmpty
          icon={NotebookPen}
          title="Sin notas"
          text="Dejá contexto para el resto del equipo: qué pasó y qué falta."
          className="py-7"
        />
      )}
      {nextCursor && (
        <MoreRow pending={pending} failed={failed} onMore={more} noun="notas" />
      )}
      <NoteDialog
        open={adding}
        onClose={() => setAdding(false)}
        userId={userId}
        fullName={fullName}
      />
    </SectionShell>
  )
}
