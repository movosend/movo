"use client"
import { useState } from "react"
import Link from "next/link"
import type {
  AdminUserBlock,
  AdminUserModeration,
} from "@movo/shared/src/types/admin-users"
import { initialsOf } from "@/lib/initials"
import { formatDate } from "@/lib/users/format"
import { Button } from "@/components/ui/button"
import { ReportSection } from "../ficha-status"
import { Eyebrow, SectionShell } from "../ui"

const FIRST = 6
const STEP = 12

function BlockColumn({
  title,
  items,
  total,
  emptyText,
}: {
  title: string
  items: AdminUserBlock[]
  total: number
  emptyText: string
}) {
  const [shown, setShown] = useState(FIRST)
  return (
    <div className="flex flex-col gap-2.5 border-r px-[18px] py-4 last:border-r-0">
      <Eyebrow>
        {title} · {total}
      </Eyebrow>
      {items.slice(0, shown).map((b) => (
        <Link
          key={`${b.user.id}${b.createdAt}`}
          href={`/users/${b.user.id}`}
          className="flex items-center gap-2.5 text-[13px]"
        >
          <span className="flex size-7 flex-none items-center justify-center rounded-full bg-avatar text-[10px] font-semibold">
            {initialsOf(b.user.fullName)}
          </span>
          <span className="flex-1 font-medium underline underline-offset-[3px]">
            {b.user.fullName}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDate(b.createdAt)}
          </span>
        </Link>
      ))}
      {items.length === 0 && (
        <span className="text-[13px] text-fg2">{emptyText}</span>
      )}
      {items.length > shown && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 self-start px-2 text-[13px]"
          onClick={() => setShown((n) => n + STEP)}
        >
          Ver {Math.min(STEP, items.length - shown)} más
        </Button>
      )}
      {total > items.length && shown >= items.length && (
        <span className="text-xs text-muted-foreground">
          Se muestran los {items.length} más recientes de {total}.
        </span>
      )}
    </div>
  )
}

export function BlocksPanel({
  blocks,
  totals,
}: {
  blocks: AdminUserModeration["blocks"]
  totals: AdminUserModeration["totals"]
}) {
  return (
    <SectionShell id="bloqueos">
      <ReportSection
        id="bloqueos"
        status="ready"
        count={totals.blocksMade + totals.blocksReceived}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        <BlockColumn
          title="Bloqueó a"
          items={blocks.made}
          total={totals.blocksMade}
          emptyText="No bloqueó a nadie."
        />
        <BlockColumn
          title="Lo bloquearon"
          items={blocks.received}
          total={totals.blocksReceived}
          emptyText="Nadie lo bloqueó."
        />
      </div>
    </SectionShell>
  )
}
