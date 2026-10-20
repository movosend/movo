import { loadModeration } from "@/lib/users/load"
import { SectionError } from "../section-error"
import { SectionShell } from "../ui"
import { BlocksPanel } from "./blocks-panel"
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
      totals={{
        received: result.data.totals.reportsReceived,
        made: result.data.totals.reportsMade,
      }}
    />
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
  return <BlocksPanel blocks={result.data.blocks} totals={result.data.totals} />
}
