"use client"
import Link from "next/link"
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { PanelLeftClose, RotateCw, Search, TriangleAlert } from "lucide-react"
import {
  SUPPORT_STATUSES,
  SUPPORT_WAIT_ALERT_MINUTES,
  type SupportConversationRow,
  type SupportCounts,
  type SupportStatus,
} from "@movo/shared/src/types/admin-support"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { UserAvatar } from "@/components/user-avatar"
import { supportClient } from "@/lib/support/client"
import {
  EMPTY_TEXT,
  PRIORITY_LABEL,
  TAB_LABEL,
  TOPIC_LABEL,
} from "@/lib/support/labels"
import { cn } from "@/lib/utils"
import {
  activityLabel,
  firstName,
  isUrgent,
  previewOf,
  PRIORITY_DOT,
} from "./format"
import { usePanels } from "./panel-layout"
import { useSupportMessages } from "./support-provider"
import { TopicIcon } from "./topic-icon"

type Owner = "all" | "mine" | "none"
const OWNERS: { value: Owner; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "mine", label: "Míos" },
  { value: "none", label: "Sin asignar" },
]
const ASSIGNEE: Record<Owner, string | undefined> = {
  all: undefined,
  mine: "me",
  none: "none",
}
const SEARCH_DEBOUNCE_MS = 300
const REFRESH_DEBOUNCE_MS = 300

/** Filtros de la bandeja, leídos de la URL: `?status=&owner=&q=` (default: Abiertos, Todos). */
export function useInboxFilters() {
  const params = useSearchParams()
  const status = params.get("status") as SupportStatus | null
  const owner = params.get("owner") as Owner | null
  return {
    status: status && SUPPORT_STATUSES.includes(status) ? status : "open",
    owner: owner === "mine" || owner === "none" ? owner : "all",
    q: (params.get("q") ?? "").slice(0, 100),
  } satisfies { status: SupportStatus; owner: Owner; q: string }
}

function Row({
  row,
  meId,
  selected,
  href,
}: {
  row: SupportConversationRow
  meId: string
  selected: boolean
  href: string
}) {
  const waiting = row.status === "open"
  const late = waiting && row.waitMinutes >= SUPPORT_WAIT_ALERT_MINUTES
  const wait = row.waitMinutes < 1 ? "recién" : `espera ${row.waitMinutes} min`
  return (
    <Link
      href={href}
      data-row
      aria-current={selected ? "page" : undefined}
      aria-label={`${row.user.fullName}, ${row.code}${row.unread ? `, ${row.unread} sin leer` : ""}`}
      className={cn(
        "grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 border-b px-4 py-3 outline-none hover:bg-surface-sub focus-visible:bg-surface-sub focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected && "bg-muted hover:bg-muted"
      )}
    >
      <UserAvatar name={row.user.fullName} size={36} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          {isUrgent(row.priority) && (
            <span
              title={`Prioridad ${PRIORITY_LABEL[row.priority].toLowerCase()}`}
              role="img"
              aria-label={`Prioridad ${PRIORITY_LABEL[row.priority].toLowerCase()}`}
              className={cn(
                "size-2 shrink-0 rounded-full",
                PRIORITY_DOT[row.priority]
              )}
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              row.unread ? "font-semibold" : "font-medium"
            )}
          >
            {row.user.fullName}
          </span>
          <span
            className={cn(
              "text-xs whitespace-nowrap tabular-nums",
              late ? "font-semibold text-danger-fg" : "text-muted-foreground"
            )}
          >
            {waiting ? wait : activityLabel(row.lastActivityAt)}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <TopicIcon topic={row.topic} className="size-3 shrink-0" />
          <span className="truncate">{TOPIC_LABEL[row.topic]}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{row.code}</span>
          {row.assignee && (
            <span
              title={`Asignada a ${row.assignee.fullName}`}
              className="ml-auto flex shrink-0 items-center gap-1"
            >
              <span className="flex size-4 items-center justify-center rounded-full bg-avatar text-[8px] font-semibold text-foreground">
                {row.assignee.id === meId
                  ? "V"
                  : firstName(row.assignee.fullName)[0]}
              </span>
              <span className="sr-only">
                Asignada a {row.assignee.fullName}
              </span>
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              row.unread ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {previewOf(row, meId)}
          </span>
          {row.unread > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-lime px-1.5 text-[11px] font-semibold text-[#0a0a0b]">
              {row.unread}
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}

function ListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Columna izquierda de la bandeja (AC3–AC5): pestañas por estado y chips de asignación con conteo,
 * buscador y filas. El orden y los filtros los resuelve el backend; acá solo se pide. Se mantiene
 * al día con los eventos en vivo y se refresca entera al recuperar la conexión.
 */
export function ConversationList({ meId }: { meId: string }) {
  const router = useRouter()
  const { toggle } = usePanels()
  const pathname = usePathname()
  const { id: selectedId } = useParams<{ id?: string }>()
  const { status, owner, q } = useInboxFilters()
  const [draft, setDraft] = useState(q)
  // Lo cargado se asocia a los filtros que lo pidieron: con otros filtros se ve el esqueleto.
  const key = `${status}|${owner}|${q}`
  const [data, setData] = useState<{
    key: string
    items: SupportConversationRow[]
    next: string | null
    counts: SupportCounts
  } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [draftFor, setDraftFor] = useState(q)
  const fresh = data?.key === key ? data : null
  const items = fresh?.items ?? null
  const counts = fresh?.counts ?? data?.counts ?? null
  const next = fresh?.next ?? null
  const error = failedKey === key
  const setItems = (
    update: (all: SupportConversationRow[] | null) => SupportConversationRow[]
  ) => setData((d) => (d ? { ...d, items: update(d.items) } : d))
  const setNext = (value: string | null) =>
    setData((d) => (d ? { ...d, next: value } : d))
  const [moreError, setMoreError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const href = useCallback(
    (patch: Partial<{ status: SupportStatus; owner: Owner; q: string }>) => {
      const merged = { status, owner, q, ...patch }
      const query = new URLSearchParams()
      if (merged.status !== "open") query.set("status", merged.status)
      if (merged.owner !== "all") query.set("owner", merged.owner)
      if (merged.q.trim()) query.set("q", merged.q.trim())
      const qs = query.size ? `?${query}` : ""
      return `${selectedId ? `/support/${selectedId}` : "/support"}${qs}`
    },
    [status, owner, q, selectedId]
  )
  const rowHref = (id: string) => {
    const query = href({}).split("?")[1]
    return `/support/${id}${query ? `?${query}` : ""}`
  }

  const load = useCallback(() => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const filters = { status, assignee: ASSIGNEE[owner], q: q || undefined }
    Promise.all([
      supportClient.list(filters, controller.signal),
      supportClient.counts(filters, controller.signal),
    ])
      .then(([page, nextCounts]) => {
        setData({
          key,
          items: page.items,
          next: page.nextCursor,
          counts: nextCounts,
        })
        setFailedKey(null)
        setMoreError(false)
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name === "AbortError") return
        setFailedKey(key)
      })
  }, [status, owner, q, key])

  // Carga inicial y al cambiar pestaña, chip o búsqueda.
  useEffect(() => {
    load()
    return () => abort.current?.abort()
  }, [load])

  // La URL manda: si cambia desde afuera (atrás/adelante), el buscador la sigue.
  if (draftFor !== q) {
    setDraftFor(q)
    setDraft(q)
  }

  useEffect(() => {
    if (draft.trim() === q.trim()) return
    const timer = setTimeout(
      () => router.replace(href({ q: draft }), { scroll: false }),
      SEARCH_DEBOUNCE_MS
    )
    return () => clearTimeout(timer)
  }, [draft, q, router, href])

  // En vivo: cualquier cambio vuelve a pedir la primera página (el orden lo decide el backend).
  const refresh = useRef<ReturnType<typeof setTimeout> | null>(null)
  useSupportMessages((message) => {
    if (message.type === "event" && message.event.type === "counts_updated")
      return
    if (refresh.current) clearTimeout(refresh.current)
    refresh.current = setTimeout(
      () => load(),
      message.type === "resync" ? 0 : REFRESH_DEBOUNCE_MS
    )
  })
  useEffect(
    () => () => {
      if (refresh.current) clearTimeout(refresh.current)
    },
    []
  )

  const more = () => {
    if (!next || loadingMore) return
    setLoadingMore(true)
    setMoreError(false)
    supportClient
      .list({
        status,
        assignee: ASSIGNEE[owner],
        q: q || undefined,
        cursor: next,
      })
      .then((page) => {
        setItems((all) => [...(all ?? []), ...page.items])
        setNext(page.nextCursor)
      })
      .catch(() => setMoreError(true))
      .finally(() => setLoadingMore(false))
  }

  // ↑/↓ mueven el foco entre filas; Enter abre (es un link).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const rows = [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []),
    ]
    if (!rows.length) return
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const to =
      e.key === "ArrowDown"
        ? Math.min(rows.length - 1, at + 1)
        : Math.max(0, at - 1)
    e.preventDefault()
    rows[at < 0 ? 0 : to]?.focus()
  }

  const countOf = (value: SupportStatus) => counts?.byStatus[value]
  const ownerCount = (value: Owner) => counts?.byOwner[value]

  return (
    <section
      aria-label="Consultas"
      className="flex min-h-0 min-w-0 flex-col border-r bg-card"
    >
      <div className="flex flex-col gap-3 border-b px-4 pt-4 pb-3">
        <div
          role="tablist"
          aria-label="Estado"
          className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-[3px]"
        >
          {SUPPORT_STATUSES.map((value) => {
            const on = value === status
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() =>
                  router.replace(href({ status: value }), { scroll: false })
                }
                className={cn(
                  "flex h-[30px] min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-md px-1 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on
                    ? "bg-card text-foreground shadow-(--shadow-1)"
                    : "text-fg2 hover:text-foreground"
                )}
              >
                {TAB_LABEL[value]}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {countOf(value) ?? ""}
                </span>
              </button>
            )
          })}
        </div>
        <div
          role="group"
          aria-label="Asignación"
          className="flex flex-wrap gap-1.5"
        >
          {OWNERS.map(({ value, label }) => {
            const on = value === owner
            const count = ownerCount(value)
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  router.replace(href({ owner: value }), { scroll: false })
                }
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on
                    ? "border-foreground bg-foreground text-card"
                    : "border-border-strong bg-card text-fg2 hover:text-foreground"
                )}
              >
                {label}
                <span
                  className={cn(
                    "tabular-nums",
                    on
                      ? "text-card"
                      : value === "none" && count
                        ? "text-warn-fg"
                        : "text-muted-foreground"
                  )}
                >
                  {count ?? ""}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border-strong bg-card px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
            <Search aria-hidden className="size-4 shrink-0" />
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={100}
              placeholder="Buscá por nombre, SOP o código de envío"
              aria-label="Buscar consultas"
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <button
            type="button"
            onClick={() => toggle("list")}
            aria-label="Ocultar la lista de consultas"
            title="Ocultar la lista de consultas"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-strong text-fg2 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:hidden"
          >
            <PanelLeftClose aria-hidden className="size-4" />
          </button>
        </div>
      </div>
      <div
        ref={listRef}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        aria-busy={items === null && !error}
      >
        {error ? (
          <div
            role="alert"
            className="m-4 flex flex-col items-start gap-2 rounded-lg bg-danger-soft p-3.5 text-sm"
          >
            <span className="flex items-center gap-2 font-medium">
              <TriangleAlert aria-hidden className="size-4 text-danger-fg" />
              No pudimos cargar las consultas.
            </span>
            <Button size="sm" variant="outline" onClick={() => load()}>
              <RotateCw /> Reintentar
            </Button>
          </div>
        ) : items === null ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
            {q
              ? "No hay consultas que coincidan con la búsqueda."
              : EMPTY_TEXT[status]}
          </p>
        ) : (
          <>
            {items.map((row) => (
              <Row
                key={row.id}
                row={row}
                meId={meId}
                selected={row.id === selectedId}
                href={rowHref(row.id)}
              />
            ))}
            {next && (
              <div className="flex flex-col items-center gap-2 p-3">
                {moreError && (
                  <span role="alert" className="text-xs text-danger-fg">
                    No pudimos traer más consultas.
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={more}
                >
                  {loadingMore
                    ? "Cargando…"
                    : moreError
                      ? "Reintentar"
                      : "Cargar más"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {pathname.startsWith("/support") && counts
          ? `${counts.byOwner.all} consultas`
          : ""}
      </span>
    </section>
  )
}
