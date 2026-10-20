import { loadSection } from "@/lib/users/load"
import { SectionError } from "../section-error"
import { SectionShell } from "../ui"
import { NotesPanel } from "./notes-panel"

export async function NotesSection({
  id,
  fullName,
}: {
  id: string
  fullName: string
}) {
  const result = await loadSection(id, "notes", { limit: 20 })
  if (!result.ok)
    return (
      <SectionShell id="notas">
        <SectionError id="notas" userId={id} status={result.status} />
      </SectionShell>
    )
  // La clave recrea el panel cuando entra una nota nueva (desde "Acciones" o desde esta sección).
  return (
    <NotesPanel
      key={result.data.items[0]?.id ?? "empty"}
      userId={id}
      fullName={fullName}
      initial={result.data}
    />
  )
}
