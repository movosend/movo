import { AdminShell } from "@/components/admin-shell"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/kyc" defaultOpen={await sidebarDefaultOpen()}>
      <SkeletonGroup className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 pt-6 pb-14 md:px-8">
        <div className="overflow-hidden rounded-[14px] border bg-card">
          <div className="flex flex-col gap-5 px-6 pt-[18px] pb-6">
            <Skeleton className="h-4 w-32" />
            <div className="flex items-center gap-5">
              <Skeleton className="size-[72px] rounded-full" />
              <div className="flex flex-1 flex-col gap-2.5">
                <Skeleton className="h-7 w-64" />
                <Skeleton className="h-4 w-96 max-w-full" />
              </div>
              <Skeleton className="hidden h-11 w-64 rounded-lg sm:block" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t bg-border min-[1100px]:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 bg-card px-5 py-3.5">
                <Skeleton className="size-[38px] rounded-[9px]" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-[19px] w-14" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[210px_minmax(0,1fr)] min-[1440px]:grid-cols-[210px_minmax(0,1fr)_290px]">
          <Skeleton className="hidden h-72 rounded-[14px] min-[1100px]:block" />
          <div className="flex flex-col gap-5">
            <Skeleton className="h-80 rounded-[14px]" />
            <Skeleton className="h-64 rounded-[14px]" />
          </div>
          <Skeleton className="h-96 rounded-[14px] min-[1100px]:col-start-2 min-[1440px]:col-start-auto" />
        </div>
      </SkeletonGroup>
    </AdminShell>
  )
}
