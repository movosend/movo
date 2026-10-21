import { AdminShell } from "@/components/admin-shell"
import { CardGridSkeleton, PageSkeleton } from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell defaultOpen={await sidebarDefaultOpen()}>
      <PageSkeleton>
        <Skeleton className="h-40 rounded-[14px]" />
        <CardGridSkeleton />
      </PageSkeleton>
    </AdminShell>
  )
}
