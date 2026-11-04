import { AdminShell } from "@/components/admin-shell"
import {
  PageHeaderSkeleton,
  PageSkeleton,
  TableSkeleton,
} from "@/components/skeletons"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell defaultOpen={await sidebarDefaultOpen()}>
      <PageSkeleton className="max-w-[1280px] gap-5 pt-7 md:pt-7">
        <PageHeaderSkeleton />
        <TableSkeleton rows={8} />
      </PageSkeleton>
    </AdminShell>
  )
}
