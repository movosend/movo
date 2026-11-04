import { AdminShell } from "@/components/admin-shell"
import {
  ChartPanelsSkeleton,
  KpiRowSkeleton,
  PageHeaderSkeleton,
  PageSkeleton,
} from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/metrics" defaultOpen={await sidebarDefaultOpen()}>
      <PageSkeleton className="max-w-[1280px] gap-[18px] pt-7 md:pt-7">
        <PageHeaderSkeleton />
        <Skeleton className="h-[54px] rounded-[10px]" />
        <div className="flex gap-4 border-b pb-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-4 w-24" />
          ))}
        </div>
        <KpiRowSkeleton />
        <ChartPanelsSkeleton />
      </PageSkeleton>
    </AdminShell>
  )
}
