import { loadSection } from "@/lib/users/load"
import { SectionError } from "../section-error"
import { SectionShell } from "../ui"
import { ActivityPanel } from "./activity-panel"

export async function ActivitySection({
  id,
  isCarrier,
}: {
  id: string
  isCarrier: boolean
}) {
  const tab = isCarrier ? "carrier" : "sender"
  const result = await loadSection(id, "shipments", {
    role: tab,
    page: 1,
    pageSize: 5,
  })
  if (!result.ok)
    return (
      <SectionShell id="actividad">
        <SectionError id="actividad" userId={id} status={result.status} />
      </SectionShell>
    )
  return <ActivityPanel userId={id} initialTab={tab} initial={result.data} />
}
