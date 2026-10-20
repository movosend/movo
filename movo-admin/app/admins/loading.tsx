import { AdminShell } from "@/components/admin-shell"
import {
  ListSkeleton,
  PageHeaderSkeleton,
  PageSkeleton,
} from "@/components/skeletons"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/admins" defaultOpen={await sidebarDefaultOpen()}>
      <PageSkeleton>
        <PageHeaderSkeleton />
        <ListSkeleton />
      </PageSkeleton>
    </AdminShell>
  )
}
