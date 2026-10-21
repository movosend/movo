import { loadSection } from "@/lib/users/load"
import { SectionError } from "../section-error"
import { SectionShell } from "../ui"
import { RatingsPanel } from "./ratings-panel"

export async function RatingsSection({ id }: { id: string }) {
  const result = await loadSection(id, "ratings", { page: 1, pageSize: 5 })
  if (!result.ok)
    return (
      <SectionShell id="calificaciones">
        <SectionError id="calificaciones" userId={id} status={result.status} />
      </SectionShell>
    )
  return <RatingsPanel userId={id} initial={result.data} />
}
