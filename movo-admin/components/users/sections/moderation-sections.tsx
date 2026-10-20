import Link from "next/link"
import type { AdminUserBlock } from "@movo/shared/src/types/admin-users"
import { initialsOf } from "@/lib/initials"
import { formatDate } from "@/lib/users/format"
import { loadModeration } from "@/lib/users/load"
import { ReportSection } from "../ficha-status"
import { SectionError } from "../section-error"
import { Eyebrow, SectionShell } from "../ui"
import { ReportsPanel } from "./reports-panel"

export async function ReportsSection({ id }: { id: string }) {
  const result = await loadModeration(id)
  if (!result.ok)
    return (
      <SectionShell id="reportes">
        <SectionError id="reportes" userId={id} status={result.status} />
      </SectionShell>
    )
  return (
    <ReportsPanel
      received={result.data.reports.received}
      made={result.data.reports.made}
    />
  )
}

function BlockColumn({
  title,
  items,
  emptyText,
}: {
  title: string
  items: AdminUserBlock[]
  emptyText: string
}) {
  return (
    <div className="flex flex-col gap-2.5 border-r px-[18px] py-4 last:border-r-0">
      <Eyebrow>
        {title} · {items.length}
      </Eyebrow>
      {items.map((b) => (
        <Link
          key={`${b.user.id}${b.createdAt}`}
          href={`/users/${b.user.id}`}
          className="flex items-center gap-2.5 text-[13px]"
        >
          <span className="flex size-7 flex-none items-center justify-center rounded-full bg-avatar text-[10px] font-semibold">
            {initialsOf(b.user.fullName)}
          </span>
          <span className="flex-1 font-medium underline underline-offset-[3px]">
            {b.user.fullName}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDate(b.createdAt)}
          </span>
        </Link>
      ))}
      {items.length === 0 && (
        <span className="text-[13px] text-fg2">{emptyText}</span>
      )}
    </div>
  )
}

export async function BlocksSection({ id }: { id: string }) {
  const result = await loadModeration(id)
  if (!result.ok)
    return (
      <SectionShell id="bloqueos">
        <SectionError id="bloqueos" userId={id} status={result.status} />
      </SectionShell>
    )
  const { made, received } = result.data.blocks
  return (
    <SectionShell id="bloqueos">
      <ReportSection
        id="bloqueos"
        status="ready"
        count={made.length + received.length}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        <BlockColumn
          title="Bloqueó a"
          items={made}
          emptyText="No bloqueó a nadie."
        />
        <BlockColumn
          title="Lo bloquearon"
          items={received}
          emptyText="Nadie lo bloqueó."
        />
      </div>
    </SectionShell>
  )
}
