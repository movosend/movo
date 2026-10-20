import { AdminShell } from "@/components/admin-shell"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { sidebarDefaultOpen } from "@/lib/sidebar"

export default async function Loading() {
  return (
    <AdminShell current="/users" defaultOpen={await sidebarDefaultOpen()}>
      <SkeletonGroup className="mx-auto flex max-w-[1400px] flex-col gap-5 px-5 pt-7 pb-14 md:px-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-full max-w-[560px] rounded-lg" />
        <div className="overflow-hidden rounded-[10px] border bg-card">
          <div className="h-10 border-b bg-surface-sub" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 border-b px-[18px] py-4"
            >
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </SkeletonGroup>
    </AdminShell>
  )
}
