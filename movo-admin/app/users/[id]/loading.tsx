import { AdminShell } from "@/components/admin-shell"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/users" defaultOpen={await sidebarDefaultOpen()}>
      <SkeletonGroup className="mx-auto flex max-w-[1280px] flex-col gap-5 px-5 pt-6 pb-16 md:px-8">
        <div className="rounded-[14px] border bg-card">
          <div className="flex flex-col gap-5 px-6 py-[18px]">
            <Skeleton className="h-4 w-36" />
            <div className="flex items-center gap-[18px]">
              <Skeleton className="size-16 rounded-full" />
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-7 w-64 max-w-full" />
                <Skeleton className="h-4 w-96 max-w-full" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t bg-border min-[1100px]:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-card px-5 py-3.5"
              >
                <Skeleton className="size-[38px] rounded-[9px]" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-14" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[10px] border bg-card p-[18px]">
            <Skeleton className="mb-4 h-5 w-40" />
            <Skeleton className="mb-2.5 h-3 w-2/5" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </SkeletonGroup>
    </AdminShell>
  )
}
