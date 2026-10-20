import { loadSection } from "@/lib/users/load"
import { SectionError } from "../section-error"
import { SectionShell } from "../ui"
import { AuditPanel } from "./audit-panel"

export async function AuditSection({ id }: { id: string }) {
  const result = await loadSection(id, "audit", { limit: 20 })
  if (!result.ok)
    return (
      <SectionShell id="bitacora">
        <SectionError id="bitacora" userId={id} status={result.status} />
      </SectionShell>
    )
  return <AuditPanel userId={id} initial={result.data} />
}
