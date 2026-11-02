"use client"
import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Flag,
  Headset,
  MessageSquareWarning,
  RefreshCw,
  Scale,
  ShieldAlert,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import type {
  AdminOverview,
  AdminOverviewBlockId,
} from "@movo/shared/src/types/admin-reports"
import { ageShort, vsYesterday } from "@/lib/reports/format"
import {
  INBOXES,
  inboxChips,
  overviewSummary,
  type InboxDef,
  type OverviewBlocks,
} from "@/lib/reports/overview"
import { formatClock } from "@/lib/shipments/format"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

const ICONS: Record<InboxDef["icon"], LucideIcon> = {
  Scale,
  Headset,
  BadgeCheck,
  Flag,
  TriangleAlert,
  Wallet,
  MessageSquareWarning,
  ShieldAlert,
}

/** Columnas de la tabla de bandejas, las del prototipo; bajo `md` se apilan. */
const COLS =
  "grid-cols-[32px_minmax(0,1fr)_48px_16px] md:grid-cols-[32px_minmax(150px,1.3fr)_minmax(120px,1.7fr)_48px_72px_64px_16px]"

/**
 * Inicio (MOVO-345): las ocho bandejas en una tabla, primero las fuera de plazo. Cada tarjeta trae
 * su dato o su error, y "Reintentar" pide solo esa (`/api/overview?blocks=`): una bandeja caída no
 * tira la home.
 */
export function OverviewInbox({ initial }: { initial: AdminOverview }) {
  const router = useRouter()
  // La página lo monta con `key={generatedAt}`: tras "Actualizar" arranca de cero con lo nuevo.
  const [blocks, setBlocks] = useState<OverviewBlocks>(initial.blocks)
  const [loading, setLoading] = useState<Set<AdminOverviewBlockId>>(new Set())
  const [refreshing, startRefresh] = useTransition()
  const [now, setNow] = useState(() => new Date(initial.generatedAt))
  const at = initial.generatedAt

  // Las antigüedades ("14 min") se recalculan cada 30 s sin volver a pedir nada.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const retry = async (id: AdminOverviewBlockId) => {
    setLoading((s) => new Set(s).add(id))
    try {
      const res = await fetch(
        `/api/overview?${new URLSearchParams({ blocks: id })}`
      )
      const body = res.ok ? ((await res.json()) as AdminOverview) : null
      const block = body?.blocks[id] ?? {
        data: null,
        error: {
          code: "BLOCK_UNAVAILABLE",
          message: "No se pudo obtener esta bandeja.",
        },
      }
      setBlocks((prev) => ({ ...prev, [id]: block }))
    } finally {
      setLoading((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    }
  }

  const over = INBOXES.filter((d) => blocks[d.id]?.data?.overSla)
  const rest = INBOXES.filter((d) => !blocks[d.id]?.data?.overSla)
  const groups = [
    { label: "Fuera de plazo", dot: "bg-dot-warning", items: over },
    { label: "Al día", dot: "bg-muted-foreground", items: rest },
  ].filter((g) => g.items.length)

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-5 pt-7 pb-14 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Inicio
          </h1>
          <p className="text-sm text-pretty text-fg2" aria-live="polite">
            {overviewSummary(blocks, loading, now)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          className="flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-card px-3.5 text-sm font-medium hover:bg-muted disabled:opacity-70"
        >
          <RefreshCw
            className={cn("size-[15px]", refreshing && "animate-spin")}
          />
          Actualizar
          <span className="font-mono text-xs text-muted-foreground">
            {formatClock(at)}
          </span>
        </button>
      </div>

      <section
        aria-label="Bandejas"
        className="overflow-hidden rounded-[10px] border bg-card"
      >
        <div
          aria-hidden
          className={cn(
            "grid h-9 items-center gap-x-4 border-b px-[18px] text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase",
            COLS
          )}
        >
          <span />
          <span>Bandeja</span>
          <span className="hidden md:block">Motivos</span>
          <span className="text-right">Total</span>
          <span className="hidden md:block">Más vieja</span>
          <span className="hidden md:block">Vs ayer</span>
          <span />
        </div>
        {groups.map((g) => (
          <div key={g.label}>
            <div className="flex h-8 items-center gap-2 border-b bg-muted px-[18px] text-xs font-medium text-fg2">
              <span className={cn("size-[7px] rounded-full", g.dot)} />
              {g.label}
              <span className="font-mono text-muted-foreground">
                {g.items.length}
              </span>
            </div>
            {g.items.map((d) => (
              <InboxRow
                key={d.id}
                def={d}
                block={blocks[d.id]}
                loading={loading.has(d.id)}
                onRetry={() => retry(d.id)}
                now={now}
              />
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}

function InboxRow({
  def,
  block,
  loading,
  onRetry,
  now,
}: {
  def: InboxDef
  block: OverviewBlocks[AdminOverviewBlockId]
  loading: boolean
  onRetry: () => void
  now: Date
}) {
  const Icon = ICONS[def.icon]
  if (loading || !block)
    return (
      <div
        aria-busy
        className={cn(
          "grid min-h-[60px] items-center gap-x-4 border-b px-[18px]",
          COLS
        )}
      >
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-3 w-[70%]" />
        <Skeleton className="hidden h-5 w-1/2 rounded-full md:block" />
        <Skeleton className="h-4 w-6 justify-self-end" />
        <Skeleton className="hidden h-3 w-12 md:block" />
        <Skeleton className="hidden h-3 w-16 md:block" />
        <span />
      </div>
    )
  if (!block.data) {
    const { error } = block
    const requestId = "requestId" in error ? error.requestId : undefined
    return (
      <div
        className={cn(
          "grid min-h-[60px] items-center gap-x-4 border-b bg-danger-soft px-[18px] py-2.5",
          COLS
        )}
      >
        <span className="flex size-8 items-center justify-center rounded-lg bg-card text-muted-foreground">
          <Icon className="size-[17px]" />
        </span>
        <span className="text-sm font-medium text-fg2">{def.title}</span>
        <div className="col-span-full flex flex-wrap items-center gap-3 gap-y-1.5 pt-2 md:col-[3/-1] md:pt-0">
          <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-danger-fg">
              <AlertTriangle className="size-4" />
              No pudimos cargar esta bandeja
            </span>
            <span className="text-xs text-fg2">
              {error.message}{" "}
              <span className="font-mono text-muted-foreground">
                {[error.code, requestId].filter(Boolean).join(" · ")}
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="flex h-[30px] items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3 text-[13px] font-medium hover:bg-muted"
          >
            <RefreshCw className="size-[15px]" />
            Reintentar
          </button>
          <Link
            href={def.href}
            className="text-[13px] whitespace-nowrap text-fg2 underline underline-offset-[3px]"
          >
            Ir igual
          </Link>
        </div>
      </div>
    )
  }
  const data = block.data
  const chips = inboxChips(def, data.breakdown)
  const delta = vsYesterday(data.count, data.yesterdayCount)
  return (
    <Link
      href={def.href}
      title={def.cta}
      className={cn(
        "grid min-h-[60px] items-center gap-x-4 border-b px-[18px] py-2.5 transition-colors hover:bg-muted motion-safe:animate-in motion-safe:fade-in",
        COLS
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-fg2">
        <Icon className="size-[17px]" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm leading-snug font-medium">{def.title}</span>
        <span className="text-xs leading-snug text-muted-foreground">
          {def.sub(data as never)}
        </span>
      </span>
      <span className="hidden min-w-0 gap-1.5 overflow-hidden [mask-image:linear-gradient(90deg,#000_85%,transparent)] md:flex">
        {chips.map((c) => (
          <span
            key={c.label}
            className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs whitespace-nowrap text-fg2"
          >
            {c.label}
            <span className="font-semibold text-foreground tabular-nums">
              {c.count}
            </span>
          </span>
        ))}
      </span>
      <span className="text-right text-xl font-semibold tracking-[-0.02em] tabular-nums">
        {data.count}
      </span>
      <span
        className={cn(
          "hidden font-mono text-[13px] font-medium whitespace-nowrap md:block",
          data.overSla ? "text-warn-fg" : "text-fg2"
        )}
      >
        {data.count ? ageShort(data.oldestAt, now) : "—"}
      </span>
      <span className="hidden text-xs whitespace-nowrap text-muted-foreground md:block">
        {delta ?? "—"}
      </span>
      <ArrowRight className="size-[15px] text-muted-foreground" />
    </Link>
  )
}
