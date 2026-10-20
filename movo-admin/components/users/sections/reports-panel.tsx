"use client"
import { useState } from "react"
import { Pager } from "../pager"
import {
  CalendarX,
  CircleDollarSign,
  CircleHelp,
  Flag,
  MessageSquareWarning,
  PackageX,
} from "lucide-react"
import type {
  AdminReportReason,
  AdminUserReport,
} from "@movo/shared/src/types/admin-users"
import { formatDate, REPORT_REASON, REPORT_STATUS } from "@/lib/users/format"
import { ReportSection } from "../ficha-status"
import { Segmented } from "../segmented"
import { SectionEmpty, SectionShell, StatusPill } from "../ui"

const ICON: Record<
  AdminReportReason,
  React.ComponentType<{ className?: string }>
> = {
  harassment: MessageSquareWarning,
  no_show: CalendarX,
  damaged_package: PackageX,
  payment_issue: CircleDollarSign,
  other: CircleHelp,
}

type Tab = "recv" | "made"

function extra(r: AdminUserReport): string {
  const parts: string[] = []
  if (r.extraEntries)
    parts.push(
      `${r.extraEntries} ${r.extraEntries === 1 ? "entrada más" : "entradas más"}`
    )
  if (r.photos) parts.push(`${r.photos} ${r.photos === 1 ? "foto" : "fotos"}`)
  return parts.length ? ` · ${parts.join(" · ")}` : ""
}

const PAGE_SIZE = 5

export function ReportsPanel({
  received,
  made,
  totals,
}: {
  received: AdminUserReport[]
  made: AdminUserReport[]
  /** Cuántos hay en total; el servidor manda solo los más recientes. */
  totals: { received: number; made: number }
}) {
  const [tab, setTab] = useState<Tab>("recv")
  const [pages, setPages] = useState({ recv: 1, made: 1 })
  const all = tab === "recv" ? received : made
  const total = tab === "recv" ? totals.received : totals.made
  const page = Math.min(
    pages[tab],
    Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  )
  const list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pending = received.filter((r) => r.status === "pending").length
  return (
    <SectionShell
      id="reportes"
      aside={
        <Segmented
          label="Reportes"
          value={tab}
          onChange={setTab}
          options={[
            { value: "recv", label: "Recibidos", count: totals.received },
            { value: "made", label: "Hechos", count: totals.made },
          ]}
        />
      }
    >
      <ReportSection
        id="reportes"
        status="ready"
        count={totals.received + totals.made}
        kpi={{
          value: String(totals.received),
          sub: pending
            ? `${pending} pendiente${pending > 1 ? "s" : ""}`
            : undefined,
          tone: pending ? "warn" : undefined,
        }}
      />
      {list.map((r) => {
        const Icon = ICON[r.reason]
        return (
          <div
            key={r.id}
            className="flex flex-col gap-1.5 border-b px-[18px] py-3.5"
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon aria-hidden className="size-4 text-fg2" />
                {REPORT_REASON[r.reason]}
              </span>
              <StatusPill pill={REPORT_STATUS[r.status]} dot />
              <span className="flex-1" />
              <span className="text-xs text-muted-foreground">
                {formatDate(r.createdAt)}
              </span>
            </div>
            <span className="text-[13px] text-fg2">
              {tab === "recv" ? "Lo reportó " : "Reportó a "}
              {r.counterpart.fullName}
              <span className="text-muted-foreground">{extra(r)}</span>
            </span>
            {r.details && (
              <span className="rounded-md border bg-surface-sub px-2.5 py-2 text-[13px] leading-normal text-pretty">
                {r.details}
              </span>
            )}
          </div>
        )
      })}
      {all.length > PAGE_SIZE && (
        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={all.length}
          size={30}
          noun="reportes"
          onChange={(n) => setPages((p) => ({ ...p, [tab]: n }))}
        />
      )}
      {total > all.length && (
        <p className="border-t px-[18px] py-2.5 text-xs text-muted-foreground">
          Se muestran los {all.length} más recientes de {total}.
        </p>
      )}
      {list.length === 0 && (
        <SectionEmpty
          icon={Flag}
          title={tab === "recv" ? "Sin reportes" : "No hizo reportes"}
          text={
            tab === "recv"
              ? "Nadie reportó a esta persona."
              : "Esta persona no reportó a nadie."
          }
        />
      )}
    </SectionShell>
  )
}
