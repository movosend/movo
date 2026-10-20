import { loadSection } from "@/lib/users/load"
import { SectionError } from "../section-error"
import { SectionShell } from "../ui"
import { LedgerPanel } from "./ledger-panel"

export async function LedgerSection({ id }: { id: string }) {
  const result = await loadSection(id, "ledger", { limit: 20 })
  if (!result.ok)
    return (
      <SectionShell id="cuenta">
        <SectionError id="cuenta" userId={id} status={result.status} />
      </SectionShell>
    )
  return <LedgerPanel userId={id} initial={result.data} />
}
