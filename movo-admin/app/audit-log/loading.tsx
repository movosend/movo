import { AdminShell } from "@/components/admin-shell"
import {
  PageHeaderSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/audit-log" defaultOpen={await sidebarDefaultOpen()}>
      <PageSkeleton className="max-w-[1400px] gap-4 pt-7 md:pt-7">
        <PageHeaderSkeleton />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-[34px] w-full max-w-[340px] rounded-lg" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[34px] w-28 rounded-lg" />
          ))}
        </div>
        <TableSkeleton rows={10} />
      </PageSkeleton>
    </AdminShell>
  )
}
