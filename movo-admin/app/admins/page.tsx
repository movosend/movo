import { cookies } from "next/headers"
import type { AdminSummary } from "@movo/shared/src/types/user"
import { gateway, publicError } from "@/lib/auth/api"
import { requireAdmin } from "@/lib/auth/session"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import { AdminShell } from "@/components/admin-shell"
import { AdminsManager } from "@/components/admins-manager"

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "America/Argentina/Cordoba",
})

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
    <AdminShell fullName={profile.fullName} current="/admins">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Admins</h1>
        <p className="text-muted-foreground">
          Quién puede entrar al panel. Cada cambio queda en la bitácora.
        </p>
      </section>
      <AdminsManager
        currentUserId={profile.id}
        loadError={loadError}
        admins={admins.map((admin) => ({
          id: admin.id,
          fullName: admin.fullName,
          email: admin.email,
          suspended: admin.status !== "active",
          since: dateFormat.format(new Date(admin.grantedAt)),
        }))}
      />
    </AdminShell>
  )
}
