import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <SkeletonGroup className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-16 items-center gap-3 border-b bg-card px-5">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-12 w-1/2 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-1/3 rounded-2xl" />
        <Skeleton className="h-16 w-2/5 rounded-2xl" />
      </div>
    </SkeletonGroup>
  )
}
