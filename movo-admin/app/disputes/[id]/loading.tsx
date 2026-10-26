import { AdminShell } from "@/components/admin-shell"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/disputes" defaultOpen={await sidebarDefaultOpen()}>
      <SkeletonGroup className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 pt-6 pb-14 md:px-8">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-5">
            <Skeleton className="h-[260px] w-full rounded-[10px]" />
            <Skeleton className="h-[320px] w-full rounded-[10px]" />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-5">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-[160px] rounded-[10px]" />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[190px] rounded-[10px]" />
            ))}
          </div>
        </div>
      </SkeletonGroup>
    </AdminShell>
  )
}
