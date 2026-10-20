import type { ReactNode } from "react"
import { AdminShell } from "@/components/admin-shell"
import { ConversationList } from "@/components/support/conversation-list"
import { InboxFrame } from "@/components/support/inbox-frame"
import { requireAdmin } from "@/lib/auth/session"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function SupportLayout({
  children,
}: {
  children: ReactNode
}) {
  const profile = await requireAdmin(false, "/support")
  return (
    <AdminShell
      fullName={profile.fullName}
      email={profile.email}
      photoUrl={profile.photoUrl}
      current="/support"
      defaultOpen={await sidebarDefaultOpen()}
    >
      <InboxFrame list={<ConversationList meId={profile.id} />}>
        {children}
      </InboxFrame>
    </AdminShell>
  )
}
