import { Gavel } from "lucide-react"
import { formatDate, type Pill } from "@/lib/users/format"
import { loadSection } from "@/lib/users/load"
import { ReportSection } from "../ficha-status"
import { SectionError } from "../section-error"
import { SectionEmpty, SectionShell, StatusPill } from "../ui"

/** Historial de sanciones. Hasta MOVO-36 el backend responde vacío: se ve "Sin sanciones". */
export async function SanctionsSection({
  id,
  bannedUntil,
}: {
  id: string
  bannedUntil: string | null
}) {
  const result = await loadSection(id, "suspensions")
  if (!result.ok)
    return (
      <SectionShell id="sanciones">
        <SectionError id="sanciones" userId={id} status={result.status} />
      </SectionShell>
    )
  const items = result.data.items
  return (
    <SectionShell id="sanciones">
      <ReportSection id="sanciones" status="ready" count={items.length} />
      {items.map((x, i) => {
        const permanent = x.type === "permanent"
        const pill: Pill =
          x.status === "active"
            ? { label: "Vigente", tone: permanent ? "danger" : "warning" }
            : { label: "Levantada", tone: "neutral" }
        const meta =
          `Aplicada por ${x.adminName}` +
          (x.status === "lifted"
            ? ` · levantada el ${formatDate(x.liftedAt)} por ${x.liftedBy}`
            : !permanent && bannedUntil
              ? ` · termina el ${formatDate(bannedUntil)}`
              : "")
        return (
          <div
            key={`${x.createdAt}${i}`}
            className="flex flex-col gap-1.5 border-b px-[18px] py-3.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {permanent
                  ? "Baneo permanente"
                  : `Suspensión de ${x.days} días`}
              </span>
              <StatusPill pill={pill} dot />
              <span className="flex-1" />
              <span className="text-xs text-muted-foreground">
                {formatDate(x.createdAt)}
              </span>
            </div>
            <span className="text-[13px] leading-normal text-pretty">
              {x.reason}
            </span>
            <span className="text-xs text-muted-foreground">{meta}</span>
          </div>
        )
      })}
      {items.length === 0 && (
        <SectionEmpty
          icon={Gavel}
          title="Sin sanciones"
          text="Nunca se suspendió esta cuenta."
          className="py-7"
        />
      )}
    </SectionShell>
  )
}
