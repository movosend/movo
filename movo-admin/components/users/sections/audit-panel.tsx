"use client"
import { useState, useTransition } from "react"
import { ScrollText } from "lucide-react"
import type { AdminUserAuditPage } from "@movo/shared/src/types/admin-users"
import { AUDIT_OUTCOME, formatDateTime } from "@/lib/users/format"
import { loadAuditMore } from "@/app/users/[id]/actions"
import { ReportSection } from "../ficha-status"
import { MoreRow } from "../more-row"
import { SectionEmpty, SectionShell, StatusPill } from "../ui"

const ACTION: Record<string, string> = {
  "user.suspend": "Suspensión",
  "user.ban": "Baneo",
  "user.lift": "Sanción levantada",
  "ledger.adjust": "Ajuste de cuenta corriente",
}

/** Acciones de admins sobre esta cuenta, de la más reciente a la más vieja. Ver una ficha no deja rastro (AC4 de MOVO-293). */
export function AuditPanel({
  userId,
  initial,
}: {
  userId: string
  initial: AdminUserAuditPage
}) {
  const [items, setItems] = useState(initial.items)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [failed, setFailed] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const more = () =>
    start(async () => {
      if (!nextCursor) return
      const result = await loadAuditMore(userId, nextCursor)
      if (!result.ok) return setFailed(result.status)
      setFailed(null)
      setItems((prev) => [...prev, ...result.data.items])
      setNextCursor(result.data.nextCursor)
    })
  return (
    <SectionShell id="bitacora">
      <ReportSection id="bitacora" status="ready" count={items.length} />
      {items.map((e) => (
        <div
          key={e.id}
          className="flex flex-col gap-1.5 border-b px-[18px] py-3.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {ACTION[e.action] ?? e.action}
            </span>
            <StatusPill pill={AUDIT_OUTCOME[e.outcome]} dot />
            <span className="flex-1" />
            <span className="text-xs text-muted-foreground">
              {formatDateTime(e.createdAt)}
            </span>
          </div>
          {e.reason && (
            <span className="text-[13px] leading-normal text-pretty">
              {e.reason}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Por {e.adminName}
            {e.errorCode && <span className="font-mono"> · {e.errorCode}</span>}
          </span>
        </div>
      ))}
      {items.length === 0 && (
        <SectionEmpty
          icon={ScrollText}
          title="Sin acciones"
          text="Ningún admin actuó sobre esta cuenta."
          className="py-7"
        />
      )}
      {nextCursor && (
        <MoreRow
          pending={pending}
          failed={failed}
          onMore={more}
          noun="acciones"
        />
      )}
    </SectionShell>
  )
}
