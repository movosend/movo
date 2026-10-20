import { ScrollText } from "lucide-react"
import { AUDIT_OUTCOME, formatDateTime } from "@/lib/users/format"
import { loadSection } from "@/lib/users/load"
import { ReportSection } from "../ficha-status"
import { SectionError } from "../section-error"
import { SectionEmpty, SectionShell, StatusPill } from "../ui"

const ACTION: Record<string, string> = {
  "user.suspend": "Suspensión",
  "user.ban": "Baneo",
  "user.lift": "Sanción levantada",
  "ledger.adjust": "Ajuste de cuenta corriente",
}

/** Acciones de admins sobre esta cuenta. Ver una ficha no deja rastro (AC4 de MOVO-293). */
export async function AuditSection({ id }: { id: string }) {
  const result = await loadSection(id, "audit")
  if (!result.ok)
    return (
      <SectionShell id="bitacora">
        <SectionError id="bitacora" userId={id} status={result.status} />
      </SectionShell>
    )
  const { items, nextCursor } = result.data
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
        <p className="px-[18px] py-3 text-xs text-muted-foreground">
          Se muestran las acciones más recientes.
        </p>
      )}
    </SectionShell>
  )
}
