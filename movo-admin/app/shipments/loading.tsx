import { AdminShell } from "@/components/admin-shell"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/shipments" defaultOpen={await sidebarDefaultOpen()}>
      <SkeletonGroup className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-7 pb-14 md:px-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex gap-4 border-b pb-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-4 w-20" />
          ))}
        </div>
        <Skeleton className="h-9 w-full max-w-[420px] rounded-lg" />
        <div className="overflow-hidden rounded-[10px] border bg-card">
          <div className="h-10 border-b bg-surface-sub" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div
              key={i}
              className="flex items-center gap-6 border-b px-[18px] py-4"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="ml-auto h-3 w-14" />
            </div>
          ))}
        </div>
      </SkeletonGroup>
    </AdminShell>
  )
}
