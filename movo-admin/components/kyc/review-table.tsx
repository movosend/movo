import Link from "next/link"
import { CircleCheck, SearchX } from "lucide-react"
import type { AdminKycReviewRow } from "@movo/shared/src/types/admin-kyc"
import { UserAvatar } from "@/components/user-avatar"
import { SectionEmpty } from "@/components/users/ui"
import {
  isLongWait,
  KYC_TYPE_LABEL,
  waitingLabel,
} from "@/lib/kyc/format"
import { formatDateTime } from "@/lib/users/format"
import { cn } from "@/lib/utils"

/** Columnas de la cola: 4 en pantalla ancha, 2 (motivo bajo el nombre) debajo de 900 px. */
export const KYC_COLUMNS =
  "grid-cols-[minmax(0,2fr)_minmax(120px,auto)] min-[900px]:grid-cols-[minmax(220px,1.4fr)_110px_minmax(180px,2fr)_150px]"

export function KycHeader() {
  return (
    <div
      className={cn(
        "grid h-10 items-center gap-4 border-b bg-surface-sub px-[18px] text-xs font-medium text-muted-foreground",
        KYC_COLUMNS
      )}
    >
      <span>Persona</span>
      <span className="min-[900px]:hidden text-right">En revisión</span>
      <span className="hidden min-[900px]:block">Tipo</span>
      <span className="hidden min-[900px]:block">Qué marcó Didit</span>
      <span className="hidden text-right min-[900px]:block">En revisión</span>
    </div>
  )
}

export function KycRow({ row }: { row: AdminKycReviewRow }) {
  // Desde que entró a revisión (la persona puede terminar la verificación horas después de abrir la sesión).
  const since = row.inReviewSince ?? row.requestedAt
  const long = isLongWait(since)
  return (
    <Link
      href={`/kyc/${encodeURIComponent(row.sessionId)}`}
      className={cn(
        "grid items-center gap-4 border-b px-[18px] py-3 text-[13px] outline-none hover:bg-surface-sub focus-visible:bg-surface-sub focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        KYC_COLUMNS
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <UserAvatar
          name={row.fullName}
          photoUrl={row.photoUrl}
          className="flex-none"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{row.fullName}</span>
          <span className="truncate text-xs text-muted-foreground min-[900px]:hidden">
            {KYC_TYPE_LABEL[row.verificationType]}
            {row.reason ? ` · ${row.reason}` : ""}
          </span>
        </span>
      </span>
      <span className="hidden min-[900px]:block">
        <span className="inline-flex h-[22px] items-center rounded-full border border-border-strong px-2 text-xs whitespace-nowrap text-fg2">
          {KYC_TYPE_LABEL[row.verificationType]}
        </span>
      </span>
      <span className="hidden min-w-0 truncate text-fg2 min-[900px]:block">
        {row.reason ?? "Sin detalle: revisá el caso"}
      </span>
      <span
        className="flex flex-col items-end gap-0.5 text-right text-xs whitespace-nowrap"
        title={formatDateTime(since)}
      >
        <span
          className={cn("font-medium", long ? "text-warn-fg" : "text-fg2")}
        >
          {waitingLabel(since)}
        </span>
        <span className="hidden text-muted-foreground min-[900px]:block">
          {formatDateTime(since)}
        </span>
      </span>
    </Link>
  )
}

export function KycRows({
  rows,
  filtered,
}: {
  rows: AdminKycReviewRow[]
  /** Hay búsqueda o filtro: "sin resultados" en vez de "nada pendiente". */
  filtered: boolean
}) {
  if (rows.length === 0)
    return filtered ? (
      <SectionEmpty
        icon={SearchX}
        title="Ningún caso coincide"
        text="Probá con otro nombre, con el email o sacá el filtro de tipo."
        className="px-6 py-14"
      />
    ) : (
      <SectionEmpty
        icon={CircleCheck}
        title="No hay verificaciones para revisar"
        text="Cuando Didit marque una identidad o una licencia para revisión manual, aparece acá."
        className="px-6 py-14"
      />
    )
  return (
    <>
      {rows.map((row) => (
        <KycRow key={row.sessionId} row={row} />
      ))}
    </>
  )
}
