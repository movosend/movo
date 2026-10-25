import { Gavel } from "lucide-react"
import type { AccountSanctionClosedCause } from "@movo/shared/src/types/account-sanctions"
import type { AdminUserSanction } from "@movo/shared/src/types/admin-users"
import { formatDate, type Pill } from "@/lib/users/format"
import { loadSanctions } from "@/lib/users/load"
import {
  describeWithdrawn,
  needsWithdrawalRetry,
  withdrawalWarning,
} from "@/lib/users/sanctions"
import { RetryWithdrawalButton } from "../actions/retry-withdrawal-button"
import { ReportSection } from "../ficha-status"
import { SectionError } from "../section-error"
import { SectionEmpty, SectionShell, StatusPill } from "../ui"

const CLOSED: Record<AccountSanctionClosedCause, string> = {
  lifted: "Levantada",
  replaced: "Reemplazada",
  escalated: "Escalada a inhabilitación",
  expired: "Vencida",
}

function titleOf(s: AdminUserSanction): string {
  if (s.type === "disable") return "Inhabilitación"
  return s.endsAt
    ? `Suspensión hasta el ${formatDate(s.endsAt)}`
    : "Suspensión indefinida"
}

function metaOf(s: AdminUserSanction): string {
  const applied = `Aplicada por ${s.appliedByName ?? "el sistema"}`
  if (!s.closedCause || !s.liftedAt) return applied
  if (s.closedCause === "lifted")
    return `${applied} · levantada el ${formatDate(s.liftedAt)}${s.liftedByName ? ` por ${s.liftedByName}` : ""}`
  return `${applied} · ${CLOSED[s.closedCause].toLowerCase()} el ${formatDate(s.liftedAt)}`
}

/** Historial de sanciones (MOVO-299): motivo visible, nota interna, plazo, lo retirado y el reintento. */
export async function SanctionsSection({ id }: { id: string }) {
  const result = await loadSanctions(id)
  if (!result.ok)
    return (
      <SectionShell id="sanciones">
        <SectionError id="sanciones" userId={id} status={result.status} />
      </SectionShell>
    )
  const items = result.data.items
  return (
    <SectionShell id="sanciones">
      <ReportSection id="sanciones" status="ready" count={items.length} />
      {items.map((s) => {
        const pill: Pill = !s.liftedAt
          ? {
              label: "Vigente",
              tone: s.type === "disable" ? "danger" : "warning",
            }
          : { label: CLOSED[s.closedCause ?? "lifted"], tone: "neutral" }
        const w = s.withdrawal
        return (
          <div
            key={s.id}
            className="flex flex-col gap-1.5 border-b px-[18px] py-3.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{titleOf(s)}</span>
              <StatusPill pill={pill} dot />
              <span className="flex-1" />
              <span className="text-xs text-muted-foreground">
                {formatDate(s.startedAt)}
              </span>
            </div>
            <span className="text-[13px] leading-normal text-pretty">
              {s.reason}
            </span>
            {s.internalNote && (
              <span className="text-[13px] leading-normal text-pretty text-fg2">
                <span className="font-medium">Nota interna:</span>{" "}
                {s.internalNote}
              </span>
            )}
            {s.liftReason && (
              <span className="text-[13px] leading-normal text-pretty text-fg2">
                <span className="font-medium">Motivo al levantar:</span>{" "}
                {s.liftReason}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{metaOf(s)}</span>
            {w?.result && (
              <span className="text-xs text-muted-foreground">
                Retiro: {describeWithdrawn(w.result)}
              </span>
            )}
            {needsWithdrawalRetry(s) && (
              <div className="mt-1 flex flex-col gap-1.5">
                <span className="text-xs text-warn-fg">
                  {withdrawalWarning(s)}
                </span>
                <RetryWithdrawalButton userId={id} sanctionId={s.id} />
              </div>
            )}
          </div>
        )
      })}
      {items.length === 0 && (
        <SectionEmpty
          icon={Gavel}
          title="Sin sanciones"
          text="Nunca se suspendió ni se inhabilitó esta cuenta."
          className="py-7"
        />
      )}
    </SectionShell>
  )
}
