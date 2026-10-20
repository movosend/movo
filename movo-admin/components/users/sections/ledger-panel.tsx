"use client"
import { useState, useTransition } from "react"
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react"
import type { AdminUserLedger } from "@movo/shared/src/types/admin-users"
import {
  formatArs,
  formatDate,
  formatSignedArs,
  LEDGER_STATUS,
  LEDGER_TYPE,
  shortId,
} from "@/lib/users/format"
import { loadLedgerMore } from "@/app/users/[id]/actions"
import { ReportSection } from "../ficha-status"
import { MoreRow } from "../more-row"
import { Eyebrow, SectionEmpty, SectionShell, StatusPill } from "../ui"
import { cn } from "@/lib/utils"

const COLS =
  "grid-cols-[minmax(0,1fr)_100px_90px] min-[1180px]:grid-cols-[minmax(0,1fr)_110px_110px_100px]"

export function LedgerPanel({
  userId,
  initial,
}: {
  userId: string
  initial: AdminUserLedger
}) {
  const [items, setItems] = useState(initial.items)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [failed, setFailed] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const bal = initial.balanceArs
  const more = () =>
    start(async () => {
      if (!nextCursor) return
      const result = await loadLedgerMore(userId, nextCursor)
      if (!result.ok) return setFailed(result.status)
      setFailed(null)
      setItems((prev) => [...prev, ...result.data.items])
      setNextCursor(result.data.nextCursor)
    })
  const debt = bal > 0
  const label = debt
    ? `Debe ${formatArs(bal)}`
    : bal < 0
      ? `A favor ${formatArs(bal)}`
      : "Al día"
  return (
    <SectionShell id="cuenta">
      <ReportSection
        id="cuenta"
        status="ready"
        count={items.length}
        balanceArs={bal}
        kpi={{
          value: bal === 0 ? "Al día" : formatArs(bal),
          sub: debt ? "debe" : bal < 0 ? "a favor" : undefined,
          tone: debt ? "warn" : undefined,
        }}
      />
      <div className="mv-grid-flat flex flex-col gap-1.5 border-b px-[18px] py-5">
        <Eyebrow className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              debt ? "bg-dot-warning" : "bg-lime"
            )}
          />
          Saldo
        </Eyebrow>
        <span
          className={cn(
            "text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums",
            debt && "text-warn-fg",
            bal < 0 && "text-success-fg"
          )}
        >
          {label}
        </span>
        <span className="text-xs text-muted-foreground">
          Suma de los movimientos no anulados. Positivo es lo que la persona le
          debe a Movo.
        </span>
      </div>
      {items.map((x) => {
        const voided = x.status === "voided"
        const owes = x.amountArs > 0
        const Icon = owes ? ArrowUpRight : ArrowDownLeft
        const sub =
          [
            x.shipmentId ? `#${shortId(x.shipmentId)}` : null,
            x.reason,
            x.adminName ? `por ${x.adminName}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"
        return (
          <div
            key={x.id}
            className={cn(
              "grid items-center gap-4 border-b px-[18px] py-3 text-[13px]",
              COLS
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "flex size-[30px] flex-none items-center justify-center rounded-lg",
                  voided
                    ? "bg-muted text-muted-foreground"
                    : owes
                      ? "bg-warn-soft text-warn-fg"
                      : "bg-success-soft text-success-fg"
                )}
              >
                <Icon aria-hidden className="size-[15px]" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{LEDGER_TYPE[x.type]}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {sub}
                  <span className="min-[1180px]:hidden">
                    {" "}
                    · {formatDate(x.createdAt)}
                  </span>
                </span>
              </span>
            </span>
            <span>
              <StatusPill pill={LEDGER_STATUS[x.status]} />
            </span>
            <span className="hidden text-xs text-fg2 min-[1180px]:block">
              {formatDate(x.createdAt)}
            </span>
            <span
              className={cn(
                "text-right font-medium tabular-nums",
                voided
                  ? "text-muted-foreground line-through"
                  : !owes && "text-success-fg"
              )}
            >
              {formatSignedArs(x.amountArs)}
            </span>
          </div>
        )
      })}
      {items.length === 0 && (
        <SectionEmpty
          icon={Wallet}
          title="Sin movimientos"
          text="No tiene penalidades, comisiones ni ajustes."
          className="py-6"
        />
      )}
      {nextCursor && (
        <MoreRow
          pending={pending}
          failed={failed}
          onMore={more}
          noun="movimientos"
        />
      )}
    </SectionShell>
  )
}
