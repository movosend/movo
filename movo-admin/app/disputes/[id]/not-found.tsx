import Link from "next/link"
import { SearchX } from "lucide-react"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"
import { AdminShell } from "@/components/admin-shell"
import { SectionEmpty } from "@/components/users/ui"

export default async function NotFound() {
  const admin = await requireAdmin(false, "/disputes")
  return (
    <AdminShell
      fullName={admin.fullName}
      email={admin.email}
      photoUrl={admin.photoUrl}
      defaultOpen={await sidebarDefaultOpen()}
      current="/disputes"
    >
      <div className="mx-auto flex max-w-[1280px] flex-col items-center gap-3 px-5 pt-16 pb-16 md:px-8">
        <SectionEmpty
          icon={SearchX}
          title="No encontramos esa disputa"
          text="El link no corresponde a ninguna disputa."
        />
        <Link
          href="/disputes"
          className="text-sm font-medium underline underline-offset-4"
        >
          Volver a disputas
        </Link>
      </div>
    </AdminShell>
  )
}
