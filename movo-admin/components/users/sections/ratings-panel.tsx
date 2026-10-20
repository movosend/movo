"use client"
import { useRef, useState, useTransition } from "react"
import { RotateCw, Star, TriangleAlert } from "lucide-react"
import type { AdminUserRatings } from "@movo/shared/src/types/admin-users"
import { formatDate, formatRating, shortId } from "@/lib/users/format"
import { loadRatingsPage } from "@/app/users/[id]/actions"
import { Button } from "@/components/ui/button"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { ReportSection } from "../ficha-status"
import { Pager } from "../pager"
import { SectionEmpty, SectionShell } from "../ui"
import { cn } from "@/lib/utils"

const AS: Record<string, string> = {
  sender: "como emisor",
  carrier: "como transportista",
  receiver: "como receptor",
}

function Stars({ score }: { score: number }) {
  return (
    <span className="flex gap-0.5" role="img" aria-label={`${score} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={cn("size-[13px]", i <= score ? "text-star" : "text-muted")}
          fill="currentColor"
        />
      ))}
    </span>
  )
}

export function RatingsPanel({
  userId,
  initial,
}: {
  userId: string
  initial: AdminUserRatings
}) {
  const [data, setData] = useState(initial)
  const [page, setPage] = useState(initial.page)
  const [failed, setFailed] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const latest = useRef(0)

  const go = (next: number) =>
    start(async () => {
      const ticket = ++latest.current
      const result = await loadRatingsPage(userId, next)
      if (ticket !== latest.current) return
      if (!result.ok) return setFailed(result.status)
      setFailed(null)
      setPage(next)
      setData(result.data)
    })

  const avg = data.average === null ? null : formatRating(data.average)
  return (
    <SectionShell id="calificaciones">
      <ReportSection
        id="calificaciones"
        status="ready"
        kpi={{
          value: avg ?? "—",
          sub: data.count ? `${data.count} calif.` : "sin calificar",
        }}
      />
      {data.count === 0 ? (
        <SectionEmpty
          icon={Star}
          title="Sin calificaciones"
          text="Nadie lo calificó todavía."
        />
      ) : (
        <div className="flex flex-wrap items-start gap-6 p-[18px]">
          <div className="flex min-w-[120px] flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span className="text-4xl leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {avg}
              </span>
              <Star
                aria-hidden
                className="size-6 text-star"
                fill="currentColor"
              />
            </span>
            <span className="text-[13px] text-muted-foreground">
              {data.count === 1
                ? "1 calificación"
                : `${data.count} calificaciones`}
            </span>
          </div>
          <div
            className="flex min-w-[260px] flex-1 flex-col"
            aria-busy={pending}
          >
            {pending ? (
              <SkeletonGroup className="flex flex-col gap-3 py-2">
                {[70, 55, 62].map((w) => (
                  <Skeleton
                    key={w}
                    className="h-3.5"
                    style={{ width: `${w}%` }}
                  />
                ))}
              </SkeletonGroup>
            ) : failed ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft p-3.5"
              >
                <TriangleAlert
                  aria-hidden
                  className="size-[18px] text-danger-fg"
                />
                <span className="flex-1 text-sm">
                  No pudimos cargar esta página.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => go(page)}
                >
                  <RotateCw aria-hidden /> Reintentar
                </Button>
              </div>
            ) : (
              data.items.map((r, i) => (
                <div
                  key={`${r.shipmentId}${i}`}
                  className="flex flex-col gap-1 border-b py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Stars score={r.score} />
                    <span className="font-medium">{r.rater.fullName}</span>
                    <span className="text-muted-foreground">
                      {AS[r.roleOfRated]} · {formatDate(r.createdAt)} · #
                      {shortId(r.shipmentId)}
                    </span>
                  </div>
                  {r.comment && (
                    <span className="text-[13px] text-pretty text-fg2">
                      {r.comment}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {data.count > data.pageSize && (
        <Pager
          page={page}
          pageSize={data.pageSize}
          total={data.count}
          size={30}
          disabled={pending}
          onChange={go}
        />
      )}
    </SectionShell>
  )
}
