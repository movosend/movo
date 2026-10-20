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
  // La clave recrea el panel cuando cambia el saldo o el movimiento más reciente (un ajuste desde
  // "Acciones"): sin ella conservaría la lista que ya tenía en su estado.
  const key = `${result.data.balanceArs}:${result.data.items[0]?.id ?? ""}`
  return <LedgerPanel key={key} userId={id} initial={result.data} />
}
