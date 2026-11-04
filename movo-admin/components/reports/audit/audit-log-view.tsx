"use client"
import { useEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Download,
  ListFilter,
  ListTree,
  ScrollText,
  Search,
  Table2,
  X,
} from "lucide-react"
import type { AuditLogEntry } from "@movo/shared/src/types/admin"
import {
  auditTargetKey,
  type AdminAuditLogPage,
} from "@movo/shared/src/types/admin-reports"
import { loadAuditPage } from "@/app/audit-log/actions"
import {
  actionGroups,
  actionLabel,
  actionVerb,
  AUDIT_ACTION,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  resolveTarget,
  TARGET_TYPE_LABEL,
} from "@/lib/reports/audit-catalog"
import { shortDay } from "@/lib/reports/format"
import {
  auditFilterQuery,
  auditHref,
  auditQuery,
  AUDIT_TARGET_TYPES,
  disputeReportHref,
  EMPTY_AUDIT_STATE,
  hasAuditFilters,
  type AuditState,
} from "@/lib/reports/params"
import { argentinaDay, formatClock } from "@/lib/shipments/format"
import { shortId } from "@/lib/users/format"
import { initialsOf } from "@/lib/initials"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { MenuHeading } from "@/components/support/menu-heading"
import { Spinner, useCsvDownload } from "../csv-button"

const PILL: Record<
  "success" | "danger" | "warning",
  { bg: string; dot: string }
> = {
  success: { bg: "bg-success-soft text-success-fg", dot: "bg-dot-success" },
  danger: { bg: "bg-danger-soft text-danger-fg", dot: "bg-dot-danger" },
  warning: { bg: "bg-warn-soft text-warn-fg", dot: "bg-dot-warning" },
}

function OutcomePill({ outcome }: { outcome: AuditLogEntry["outcome"] }) {
  const tone = PILL[OUTCOME_TONE[outcome]]
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-[9px] text-xs font-medium whitespace-nowrap",
        tone.bg
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {OUTCOME_LABEL[outcome]}
    </span>
  )
}

const COLS =
  "grid-cols-[136px_minmax(150px,1fr)_minmax(210px,1.4fr)_minmax(190px,1.2fr)_116px_20px]"

export interface AdminOption {
  id: string
  fullName: string
}

/**
 * Bitácora (MOVO-345, prototipo `Movo Admin Reportes v2`): filtros en la URL, página por cursor con
 * "Cargar 20 más", vista de tabla o de línea de tiempo y el detalle de cada acción en un panel. El
 * CSV trae todas las filas del filtro, no solo las cargadas. La página lo monta con `key` = filtros.
 */
export function AuditLogView({
  state,
  initial,
  admins,
  today,
}: {
  state: AuditState
  initial: AdminAuditLogPage
  admins: AdminOption[]
  today: string
}) {
  const router = useRouter()
  const [items, setItems] = useState(initial.items)
  const [cursor, setCursor] = useState(initial.nextCursor)
  const [names, setNames] = useState(initial.admins)
  const [targets, setTargets] = useState(initial.targets)
  const [moreFailed, setMoreFailed] = useState(false)
  const [loadingMore, startMore] = useTransition()
  const [navigating, startNav] = useTransition()
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState(state.q)
  const csv = useCsvDownload()
  const first = useRef(true)

  const go = (patch: Partial<AuditState>) =>
    startNav(() =>
      router.replace(auditHref({ ...state, ...patch }), { scroll: false })
    )

  // El buscador filtra al dejar de tipear (400 ms), sin un request por tecla.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => {
      if (q.trim() !== state.q) go({ q: q.trim() })
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona al texto tipeado
  }, [q])

  const more = () =>
    startMore(async () => {
      if (!cursor) return
      const result = await loadAuditPage(auditQuery(state), cursor)
      if (!result.ok) return setMoreFailed(true)
      setMoreFailed(false)
      setItems((prev) => [...prev, ...result.data.items])
      setCursor(result.data.nextCursor)
      setNames((prev) => ({ ...prev, ...result.data.admins }))
      setTargets((prev) => ({ ...prev, ...result.data.targets }))
    })

  const adminName = (id: string) =>
    names[id]?.fullName ??
    admins.find((a) => a.id === id)?.fullName ??
    shortId(id)
  const targetOf = (e: AuditLogEntry) =>
    resolveTarget(e, targets[auditTargetKey(e.targetType, e.targetId)])
  const dayLabel = (iso: string) => {
    const day = argentinaDay(new Date(iso))
    if (day === today) return "Hoy"
    const y = new Date(`${today}T12:00:00Z`)
    y.setUTCDate(y.getUTCDate() - 1)
    if (day === y.toISOString().slice(0, 10)) return "Ayer"
    const w = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][
      new Date(`${day}T12:00:00Z`).getUTCDay()
    ]
    return `${w} ${shortDay(day)}`
  }

  const groups: { day: string; items: AuditLogEntry[] }[] = []
  for (const e of items) {
    const day = dayLabel(e.createdAt)
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(e)
    else groups.push({ day, items: [e] })
  }

  const sel = items.find((e) => e.id === selected) ?? null
  const filtered = hasAuditFilters(state)
  const exportQuery = auditFilterQuery(state)
  const exportHref = `/api/audit-log/export${exportQuery ? `?${exportQuery}` : ""}`

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-5 pt-7 pb-14 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[640px] flex-col gap-1.5">
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Bitácora
          </h1>
          <p className="text-sm text-pretty text-fg2">
            Cada acción de un admin en el panel, de la más nueva a la más vieja.
            Las filas no se editan ni se borran.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Vista"
            className="flex rounded-lg bg-muted p-[3px]"
          >
            {(
              [
                ["table", "Tabla", Table2],
                ["timeline", "Línea de tiempo", ListTree],
              ] as const
            ).map(([view, label, Icon]) => (
              <button
                key={view}
                type="button"
                aria-pressed={state.view === view}
                onClick={() => go({ view })}
                className={cn(
                  "flex h-[30px] items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap",
                  state.view === view
                    ? "bg-card text-foreground shadow-[var(--shadow-1)]"
                    : "text-fg2 hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={csv.busy}
            onClick={() =>
              csv.run(exportHref, {
                fallbackName: `movo-bitacora_${today}.csv`,
                note: "todas las que coinciden, no solo las cargadas",
              })
            }
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-[var(--primary-hover)] disabled:cursor-wait disabled:opacity-80"
          >
            {csv.busy ? (
              <Spinner className="size-3.5" />
            ) : (
              <Download className="size-4" />
            )}
            {csv.busy ? "Generando CSV…" : "Exportar CSV"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-[34px] max-w-[340px] min-w-[220px] flex-1 items-center gap-2.5 rounded-lg border border-border-strong bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4" />
          <span className="sr-only">Buscar por objetivo</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ID del objetivo, código o email"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <FilterMenu
          label="Admin"
          value={state.adminId ? adminName(state.adminId) : "Todos"}
          active={!!state.adminId}
          sections={[
            {
              items: [
                {
                  label: "Todos",
                  active: !state.adminId,
                  pick: () => go({ adminId: null }),
                },
                ...admins.map((a) => ({
                  label: a.fullName,
                  active: state.adminId === a.id,
                  pick: () => go({ adminId: a.id }),
                })),
              ],
            },
          ]}
        />
        <FilterMenu
          label="Acción"
          value={state.action ? actionLabel(state.action) : "Todas"}
          active={!!state.action}
          sections={[
            {
              items: [
                {
                  label: "Todas",
                  active: !state.action,
                  pick: () => go({ action: null }),
                },
              ],
            },
            ...actionGroups().map((g) => ({
              heading: TARGET_TYPE_LABEL[g.target],
              items: g.actions.map((a) => ({
                label: AUDIT_ACTION[a].label,
                code: a.split(".")[1],
                active: state.action === a,
                pick: () => go({ action: a }),
              })),
            })),
          ]}
        />
        <FilterMenu
          label="Objetivo"
          value={
            state.targetType ? TARGET_TYPE_LABEL[state.targetType] : "Todos"
          }
          active={!!state.targetType}
          sections={[
            {
              items: [
                {
                  label: "Todos",
                  active: !state.targetType,
                  pick: () => go({ targetType: null }),
                },
                ...AUDIT_TARGET_TYPES.map((t) => ({
                  label: TARGET_TYPE_LABEL[t],
                  code: t,
                  active: state.targetType === t,
                  pick: () => go({ targetType: t }),
                })),
              ],
            },
          ]}
        />
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQ("")
              go({ ...EMPTY_AUDIT_STATE, view: state.view })
            }}
            className="flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg2 hover:text-foreground"
          >
            <X className="size-4" />
            Limpiar
          </button>
        )}
        <span
          className="ml-auto text-[13px] text-muted-foreground"
          aria-live="polite"
        >
          {navigating
            ? "Buscando…"
            : `${items.length} ${items.length === 1 ? "cargada" : "cargadas"}${cursor ? " · hay más" : ""}`}
        </span>
      </div>

      <div
        aria-busy={navigating}
        className={cn("transition-opacity", navigating && "opacity-60")}
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[10px] border bg-card px-6 py-14 text-center">
            <ScrollText className="size-8 text-muted-foreground" />
            <span className="text-[15px] font-medium">
              {filtered
                ? "No hay acciones con esos filtros"
                : "Todavía no hay acciones"}
            </span>
            <span className="text-[13px] text-fg2">
              {filtered
                ? "Probá con otro admin u objetivo, o limpiá los filtros."
                : "Cada acción de un admin en el panel va a aparecer acá."}
            </span>
          </div>
        ) : state.view === "table" ? (
          <div className="overflow-hidden rounded-[10px] border bg-card">
            <div className="overflow-x-auto">
              <div className="min-w-[900px]">
                <div
                  aria-hidden
                  className={cn(
                    "grid h-10 items-center gap-4 border-b bg-surface-sub px-[18px] text-xs font-medium text-muted-foreground",
                    COLS
                  )}
                >
                  <span>Fecha</span>
                  <span>Admin</span>
                  <span>Acción</span>
                  <span>Objetivo</span>
                  <span>Resultado</span>
                  <span />
                </div>
                {items.map((e) => {
                  const t = targetOf(e)
                  return (
                    <div
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${actionLabel(e.action)} de ${adminName(e.adminId)}, ${dayLabel(e.createdAt)} ${formatClock(e.createdAt)}`}
                      onClick={() => setSelected(e.id)}
                      onKeyDown={(ev) =>
                        (ev.key === "Enter" || ev.key === " ") &&
                        (ev.preventDefault(), setSelected(e.id))
                      }
                      className={cn(
                        "grid cursor-pointer items-center gap-4 border-b px-[18px] py-[11px] text-[13px] outline-none hover:bg-surface-sub focus-visible:bg-surface-sub",
                        COLS,
                        selected === e.id && "bg-muted"
                      )}
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-xs font-medium">
                          {formatClock(e.createdAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {dayLabel(e.createdAt)}
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex size-[26px] flex-none items-center justify-center rounded-full bg-avatar text-[11px] font-semibold">
                          {initialsOf(adminName(e.adminId))}
                        </span>
                        <span className="truncate">{adminName(e.adminId)}</span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium">
                          {actionLabel(e.action)}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {e.action}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        {t.href ? (
                          <Link
                            href={t.href}
                            onClick={(ev) => ev.stopPropagation()}
                            className="max-w-full self-start truncate font-medium underline decoration-border-strong underline-offset-[3px] hover:decoration-current"
                          >
                            {t.label}
                          </Link>
                        ) : (
                          <span className="truncate font-medium">
                            {t.label}
                          </span>
                        )}
                        <span className="truncate text-xs text-muted-foreground">
                          {TARGET_TYPE_LABEL[e.targetType]}
                          {t.sub ? ` · ${t.sub}` : ""}
                        </span>
                      </span>
                      <span>
                        <OutcomePill outcome={e.outcome} />
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <section key={g.day} aria-label={g.day} className="flex flex-col">
                <div className="flex items-center gap-2.5 pb-2.5">
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {g.day}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">
                    {g.items.length}{" "}
                    {g.items.length === 1 ? "acción" : "acciones"}
                  </span>
                </div>
                <div className="rounded-[10px] border bg-card py-1.5">
                  {g.items.map((e) => {
                    const t = targetOf(e)
                    const tone = PILL[OUTCOME_TONE[e.outcome]]
                    return (
                      <div
                        key={e.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelected(e.id)}
                        onKeyDown={(ev) =>
                          (ev.key === "Enter" || ev.key === " ") &&
                          (ev.preventDefault(), setSelected(e.id))
                        }
                        className={cn(
                          "grid cursor-pointer grid-cols-[56px_20px_minmax(0,1fr)_auto] gap-3 px-[18px] py-2.5 outline-none hover:bg-surface-sub focus-visible:bg-surface-sub",
                          selected === e.id && "bg-muted"
                        )}
                      >
                        <span className="pt-0.5 font-mono text-xs text-muted-foreground">
                          {formatClock(e.createdAt)}
                        </span>
                        <span className="relative flex justify-center">
                          <span className="absolute -top-2.5 -bottom-2.5 w-px bg-border" />
                          <span
                            className={cn(
                              "relative mt-[5px] size-[9px] rounded-full ring-[3px] ring-card",
                              tone.dot
                            )}
                          />
                        </span>
                        <div className="flex min-w-0 flex-col gap-1">
                          <span className="text-sm leading-relaxed text-pretty">
                            <b className="font-semibold">
                              {adminName(e.adminId)}
                            </b>{" "}
                            {actionVerb(e.action)}{" "}
                            {t.href ? (
                              <Link
                                href={t.href}
                                onClick={(ev) => ev.stopPropagation()}
                                className="font-medium underline decoration-border-strong underline-offset-[3px]"
                              >
                                {t.label}
                              </Link>
                            ) : (
                              <span className="font-medium">{t.label}</span>
                            )}
                          </span>
                          {e.reason && (
                            <span className="text-[13px] leading-relaxed text-pretty text-fg2">
                              {e.reason}
                            </span>
                          )}
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {e.action}
                          </span>
                        </div>
                        {e.outcome !== "succeeded" && (
                          <span>
                            <OutcomePill outcome={e.outcome} />
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex flex-col items-center gap-2 pt-1">
          {cursor ? (
            <button
              type="button"
              onClick={more}
              disabled={loadingMore}
              className="flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-card px-4 text-sm font-medium hover:bg-muted disabled:opacity-70"
            >
              {loadingMore && <Spinner className="size-3.5" />}
              {loadingMore ? "Cargando…" : "Cargar 20 más"}
            </button>
          ) : (
            <span className="text-[13px] text-muted-foreground">
              Llegaste al principio de la bitácora para este filtro.
            </span>
          )}
          {moreFailed && (
            <span className="text-[13px] text-danger-fg">
              No pudimos cargar más. Volvé a intentar.
            </span>
          )}
        </div>
      )}

      <Sheet open={!!sel} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent
          side="right"
          className="w-[460px] max-w-[100vw] gap-0 bg-card p-0 data-[side=right]:w-[460px] data-[side=right]:sm:max-w-[460px]"
        >
          {sel && (
            <AuditDetail
              entry={sel}
              admin={adminName(sel.adminId)}
              target={targetOf(sel)}
              onFilterTarget={() => {
                setSelected(null)
                setQ(sel.targetId)
                go({
                  ...EMPTY_AUDIT_STATE,
                  view: state.view,
                  targetType: sel.targetType,
                  q: sel.targetId,
                })
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

interface MenuItem {
  label: string
  code?: string
  active: boolean
  pick: () => void
}

function FilterMenu({
  label,
  value,
  active,
  sections,
}: {
  label: string
  value: string
  active: boolean
  sections: { heading?: string; items: MenuItem[] }[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-[34px] items-center gap-1.5 rounded-lg border bg-card pr-2.5 pl-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "border-foreground" : "border-border-strong"
        )}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
        <ChevronDown className="size-[15px] text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[380px] min-w-[260px] overflow-auto"
      >
        {sections.map((s, i) => (
          <div key={s.heading ?? i}>
            {s.heading && <MenuHeading>{s.heading}</MenuHeading>}
            {s.items.map((o) => (
              <DropdownMenuItem
                key={`${o.label}-${o.code ?? ""}`}
                onClick={o.pick}
                className={cn(o.active && "bg-muted font-medium")}
              >
                <span className="flex-1">{o.label}</span>
                {o.code && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {o.code}
                  </span>
                )}
                <span className="w-4">
                  {o.active && <Check className="size-3.5" />}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AuditDetail({
  entry,
  admin,
  target,
  onFilterTarget,
}: {
  entry: AuditLogEntry
  admin: string
  target: ReturnType<typeof resolveTarget>
  onFilterTarget: () => void
}) {
  const date = new Date(entry.createdAt)
  const day = argentinaDay(date)
  const weekday = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][
    new Date(`${day}T12:00:00Z`).getUTCDay()
  ]
  const fields: {
    k: string
    v: string
    mono?: boolean
    href?: string | null
  }[] = [
    {
      k: "Fecha",
      v: `${weekday} ${shortDay(day)} ${day.slice(0, 4)} · ${formatClock(entry.createdAt)}`,
    },
    { k: "Admin", v: admin },
    {
      k: "Objetivo",
      v: `${TARGET_TYPE_LABEL[entry.targetType]} · ${target.label}`,
      href: target.href,
    },
    { k: "target_id", v: entry.targetId, mono: true },
    ...(target.sub ? [{ k: "Relacionado", v: target.sub, mono: true }] : []),
    ...(entry.errorCode
      ? [{ k: "error_code", v: entry.errorCode, mono: true }]
      : []),
    ...(entry.requestId
      ? [{ k: "request_id", v: entry.requestId, mono: true }]
      : []),
    { k: "id", v: entry.id, mono: true },
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b px-5 py-[18px] pr-14">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Acción
          </span>
          <SheetTitle className="text-lg font-semibold tracking-[-0.01em]">
            {actionLabel(entry.action)}
          </SheetTitle>
          <SheetDescription
            render={<div />}
            className="flex flex-wrap items-center gap-2"
          >
            <OutcomePill outcome={entry.outcome} />
            <span className="font-mono text-xs text-muted-foreground">
              {entry.action}
            </span>
          </SheetDescription>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-[18px] overflow-auto px-5 py-[18px]">
        {entry.outcome === "unknown" && (
          <div
            role="status"
            className="border-warn-border flex items-start gap-2.5 rounded-[10px] border bg-warn-soft px-3.5 py-3 text-[13px] leading-relaxed"
          >
            <AlertTriangle className="mt-0.5 size-4 flex-none text-warn-fg" />
            <span>
              <b className="font-semibold">
                No se sabe si el cambio se aplicó.
              </b>{" "}
              El servicio no respondió a tiempo. Mirá el objetivo antes de
              reintentar.
            </span>
          </div>
        )}
        {entry.outcome === "failed" && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-[10px] bg-danger-soft px-3.5 py-3 text-[13px] leading-relaxed"
          >
            <AlertTriangle className="mt-0.5 size-4 flex-none text-danger-fg" />
            <span>
              <b className="font-semibold">
                El intento falló y no cambió nada.
              </b>{" "}
              Igual queda registrado, como todos los intentos.
            </span>
          </div>
        )}
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
          {fields.map((f) => (
            <div key={f.k} className="contents">
              <dt className="text-muted-foreground">{f.k}</dt>
              <dd className={cn("min-w-0 break-words", f.mono && "font-mono")}>
                {f.href ? (
                  <Link
                    href={f.href}
                    className="font-medium underline underline-offset-[3px]"
                  >
                    {f.v}
                  </Link>
                ) : (
                  f.v
                )}
              </dd>
            </div>
          ))}
        </dl>
        {entry.reason && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Motivo
            </span>
            <p className="text-sm leading-normal text-pretty">{entry.reason}</p>
          </div>
        )}
        {entry.context && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Contexto
            </span>
            <pre className="rounded-lg bg-muted px-3.5 py-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {JSON.stringify(entry.context, null, 2)}
            </pre>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t px-5 py-3.5">
        {target.href && (
          <Link
            href={target.href}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-[var(--primary-hover)]"
          >
            {target.openLabel}
            <ArrowRight className="size-[15px]" />
          </Link>
        )}
        {target.disputeId && (
          <Link
            href={disputeReportHref(target.disputeId)}
            className="flex h-9 items-center gap-2 rounded-lg border border-border-strong bg-card px-3.5 text-sm font-medium hover:bg-muted"
          >
            <ChartColumn className="size-4" />
            Ver en métricas
          </Link>
        )}
        <button
          type="button"
          onClick={onFilterTarget}
          className="flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium text-fg2 hover:text-foreground"
        >
          <ListFilter className="size-4" />
          Todo sobre este objetivo
        </button>
      </div>
    </div>
  )
}
