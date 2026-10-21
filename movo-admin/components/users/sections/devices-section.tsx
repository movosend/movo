import { Apple, Smartphone } from "lucide-react"
import { formatDate } from "@/lib/users/format"
import { loadSection } from "@/lib/users/load"
import { ReportSection } from "../ficha-status"
import { SectionError } from "../section-error"
import { SectionShell } from "../ui"

export async function DevicesSection({ id }: { id: string }) {
  const result = await loadSection(id, "devices")
  if (!result.ok)
    return (
      <SectionShell id="dispositivos">
        <SectionError id="dispositivos" userId={id} status={result.status} />
      </SectionShell>
    )
  const { devices, handshakeKey } = result.data
  return (
    <SectionShell id="dispositivos">
      <ReportSection id="dispositivos" status="ready" count={devices.length} />
      {devices.map((d) => {
        const Icon = d.platform === "ios" ? Apple : Smartphone
        return (
          <div
            key={d.id}
            className="flex items-center gap-3 border-b px-[18px] py-3 text-[13px]"
          >
            <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-muted text-fg2">
              <Icon aria-hidden className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">
                {d.platform === "ios" ? "iPhone / iPad" : "Android"}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {d.deviceId}
              </span>
            </span>
            <span className="text-right text-xs text-fg2">
              token del {formatDate(d.updatedAt)}
            </span>
          </div>
        )
      })}
      {devices.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 border-b px-[18px] py-6 text-center">
          <span className="text-sm font-medium">
            Sin dispositivos registrados
          </span>
          <span className="text-[13px] text-fg2">
            No hay tokens de notificaciones activos.
          </span>
        </div>
      )}
      <p className="px-[18px] py-3 text-xs text-muted-foreground">
        {handshakeKey
          ? `Clave de handshake registrada el ${formatDate(handshakeKey.registeredAt)}`
          : "Sin clave de handshake registrada."}
      </p>
    </SectionShell>
  )
}
