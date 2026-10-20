"use client"
import { useState } from "react"
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

export function ReportsPanel({
  received,
  made,
}: {
  received: AdminUserReport[]
  made: AdminUserReport[]
}) {
  const [tab, setTab] = useState<Tab>("recv")
  const list = tab === "recv" ? received : made
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
            { value: "recv", label: "Recibidos", count: received.length },
            { value: "made", label: "Hechos", count: made.length },
          ]}
        />
      }
    >
      <ReportSection
        id="reportes"
        status="ready"
        count={received.length + made.length}
        kpi={{
          value: String(received.length),
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
