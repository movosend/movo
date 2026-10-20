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
  // La clave recrea el panel cuando entra una fila nueva (una acción de "Acciones").
  return (
    <AuditPanel
      key={result.data.items[0]?.id ?? "empty"}
      userId={id}
      initial={result.data}
    />
  )
}
