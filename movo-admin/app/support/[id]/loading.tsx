import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"

const MESSAGES = [
  { mine: false, w: "w-64", h: "h-11" },
  { mine: false, w: "w-80", h: "h-16" },
  { mine: true, w: "w-72", h: "h-11" },
  { mine: false, w: "w-56", h: "h-11" },
  { mine: true, w: "w-80", h: "h-16" },
]

/** Calca la conversación real: encabezado, burbujas con avatar, composer y ficha del usuario. */
export default function Loading() {
  return (
    <SkeletonGroup className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="flex min-h-16 shrink-0 items-center gap-3 border-b bg-card px-5 py-2.5">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <div className="hidden gap-1.5 md:flex">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-20 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden px-6 py-5">
          {MESSAGES.map(({ mine, w, h }, i) => (
            <div
              key={i}
              className={mine ? "flex justify-end" : "flex items-end gap-2"}
            >
              {!mine && <Skeleton className="size-7 shrink-0 rounded-full" />}
              <Skeleton className={`${h} ${w} max-w-[70%] rounded-2xl`} />
            </div>
          ))}
        </div>
        <div className="mx-5 mb-5 flex shrink-0 flex-col gap-3 rounded-xl border bg-card p-3">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="hidden w-[320px] shrink-0 flex-col gap-5 border-l bg-card px-5 py-4 min-[1360px]:flex">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-[22px] w-20 rounded-full" />
          <Skeleton className="h-[22px] w-16 rounded-full" />
        </div>
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    </SkeletonGroup>
  )
}
