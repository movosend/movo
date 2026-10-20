import type { Metadata } from "next"
import { cookies } from "next/headers"
import type { AdminSummary } from "@movo/shared/src/types/user"
import { gateway, publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { AdminShell } from "@/components/admin-shell"
import { AdminsManager } from "@/components/admins-manager"

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Argentina/Cordoba",
})

export const metadata: Metadata = { title: "Administradores" }

export default async function Page() {
  const profile = await requireAdmin(false, "/admins")
  let admins: AdminSummary[] = []
  let loadError: string | undefined
  try {
    admins = await gateway<AdminSummary[]>("/admin/admins", {
      accessToken: (await cookies()).get(ACCESS_COOKIE)?.value,
    })
  } catch (error) {
    loadError = publicError(error)
  }
  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/admins"
    >
      <AdminsManager
        currentUserId={profile.id}
        loadError={loadError}
        admins={admins.map((admin) => ({
          id: admin.id,
          fullName: admin.fullName,
          email: admin.email,
          // Tu propia fila usa la foto de tu perfil aunque el listado todavía no la traiga.
          photoUrl:
            admin.photoUrl ??
            (admin.id === profile.id ? (profile.photoUrl ?? null) : null),
          suspended: admin.status !== "active",
          since: dateFormat.format(new Date(admin.grantedAt)),
        }))}
      />
    </AdminShell>
  )
}
