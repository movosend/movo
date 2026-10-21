import { Car } from "lucide-react"
import { loadSection } from "@/lib/users/load"
import { ReportSection } from "../ficha-status"
import { SectionError } from "../section-error"
import { SectionEmpty, SectionShell } from "../ui"
import { cn } from "@/lib/utils"

export async function VehicleSection({
  id,
  isCarrier,
}: {
  id: string
  isCarrier: boolean
}) {
  const result = await loadSection(id, "vehicle")
  if (!result.ok)
    return (
      <SectionShell id="vehiculo">
        <SectionError id="vehiculo" userId={id} status={result.status} />
      </SectionShell>
    )
  const vehicle = result.data.vehicle
  return (
    <SectionShell id="vehiculo">
      <ReportSection id="vehiculo" status="ready" />
      {vehicle ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-[18px] p-[18px]">
          {[
            ["Vehículo", `${vehicle.brand} ${vehicle.model}`, false],
            ["Patente", vehicle.licensePlate, true],
            ["Capacidad", vehicle.cargoCapacityLabel, false],
          ].map(([k, v, mono]) => (
            <div key={String(k)} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className={cn("text-sm", mono && "font-mono")}>{v}</span>
            </div>
          ))}
        </div>
      ) : (
        <SectionEmpty
          icon={Car}
          title="Sin vehículo cargado"
          text={
            isCarrier
              ? "Tiene el rol de transportista pero no cargó la ficha."
              : "No es transportista."
          }
        />
      )}
    </SectionShell>
  )
}
