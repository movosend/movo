import type { Metadata } from "next"
import {
  ADMIN_OVERVIEW_BLOCKS,
  type AdminOverview,
} from "@movo/shared/src/types/admin-reports"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { getOverview } from "@/lib/reports/api"
import { AdminShell } from "@/components/admin-shell"
import { OverviewInbox } from "@/components/reports/overview-inbox"

export const metadata: Metadata = { title: "Inicio" }

/** Si `/admin/overview` no responde, cada tarjeta muestra el error y su "Reintentar". */
function allFailed(): AdminOverview {
  const error = {
    code: "ADMIN_SERVICE_UNAVAILABLE",
    message: "El panel no pudo hablar con svc-admin.",
  }
  return {
    generatedAt: new Date().toISOString(),
    blocks: Object.fromEntries(
      ADMIN_OVERVIEW_BLOCKS.map((id) => [id, { data: null, error }])
    ),
  }
}

export default async function Page() {
  const profile = await requireAdmin()
  const overview = await getOverview().catch(allFailed)
  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
    >
      <OverviewInbox key={overview.generatedAt} initial={overview} />
    </AdminShell>
  )
}
