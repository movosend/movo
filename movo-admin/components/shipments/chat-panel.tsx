"use client"
import { useMemo, useState, useTransition } from "react"
import { Eye, Flag, Lock, RotateCw } from "lucide-react"
import type { AdminChatPage } from "@movo/shared/src/types/admin-shipments"
import { loadChatPage } from "@/app/shipments/actions"
import { buildChatItems, type ChatItem } from "@/lib/shipments/format"
import { initialsOf } from "@/lib/initials"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"

export interface ChatHeading {
  code: string
  /** "Ana, Diego y Luis". */
  title: string
  /** Nombres de las partes, para los avatares del encabezado. */
  people: string[]
  /** "las partes pueden escribir" / "las partes solo leen". */
  mode: string
  /** "Luis reportó esta conversación · 21 oct · 12:16", uno por reporte. */
  reports: string[]
}

/** Botón "Ver chat" del encabezado del detalle y el panel lateral de solo lectura. */
export function ChatPanel({
  shipmentId,
  heading,
  first,
}: {
  shipmentId: string
  heading: ChatHeading
  first: AdminChatPage
}) {
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState<AdminChatPage[]>([first])
  const [failed, setFailed] = useState<number | null>(null)
  // Un "Reintentar" (`router.refresh()`) trae una primera página nueva: se descartan las que se
  // habían sumado con "Ver mensajes anteriores". El panel queda abierto.
  const [base, setBase] = useState(first)
  if (base !== first) {
    setBase(first)
    setPages([first])
    setFailed(null)
  }
  const [pending, start] = useTransition()
  const nextCursor = pages.at(-1)!.nextCursor
  const messages = useMemo(() => pages.flatMap((p) => p.items), [pages])
  const items = useMemo(
    () => buildChatItems(messages, first.events, nextCursor === null),
    [messages, first.events, nextCursor]
  )
  const more = () =>
    start(async () => {
      if (!nextCursor) return
      const result = await loadChatPage(shipmentId, nextCursor)
      if (result.ok) {
        setFailed(null)
        setPages((prev) => [...prev, result.page])
      } else setFailed(result.status)
    })

  const count = `${messages.length}${nextCursor ? "+" : ""}`
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-9 gap-2 px-3.5"
        onClick={() => setOpen(true)}
      >
        <Eye aria-hidden />
        Ver chat
        <span
          className="text-xs text-muted-foreground tabular-nums"
          aria-label={`${count} mensajes`}
        >
          {count}
        </span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[440px] max-w-[100vw] gap-0 bg-card p-0 data-[side=right]:w-[440px] data-[side=right]:sm:max-w-[440px]"
        >
          <div className="flex items-start gap-3 border-b px-[18px] py-4 pr-12">
            <div aria-hidden className="flex flex-none">
              {heading.people.map((name) => (
                <span
                  key={name}
                  className="-mr-2 flex size-8 items-center justify-center rounded-full border-2 border-card bg-avatar text-[11px] font-semibold"
                >
                  {initialsOf(name)}
                </span>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pl-3">
              <SheetTitle className="text-[15px] font-semibold">
                {heading.title}
              </SheetTitle>
              <SheetDescription className="text-xs">
                <span className="font-mono">#{heading.code}</span> ·{" "}
                {heading.mode} · {count} mensajes
              </SheetDescription>
            </div>
          </div>
          <ChatThread
            items={items}
            reports={heading.reports}
            hasMore={nextCursor !== null}
            pending={pending}
            failed={failed}
            onMore={more}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}

/** Cuerpo del chat: aviso de observador, reportes, hilo y pie. No tiene compositor (AC12). */
export function ChatThread({
  items,
  reports,
  hasMore,
  pending,
  failed,
  onMore,
}: {
  items: ChatItem[]
  reports: string[]
  hasMore: boolean
  pending: boolean
  failed: number | null
  onMore: () => void
}) {
  return (
    <>
      <div className="flex items-start gap-2.5 border-b bg-surface-sub px-[18px] py-2.5 text-xs leading-[1.45] text-fg2">
        <Eye aria-hidden className="mt-px size-3.5 flex-none text-foreground" />
        <span className="text-pretty">
          <strong className="font-semibold text-foreground">
            Modo observador.
          </strong>{" "}
          Leés la conversación completa, incluso lo que las partes ya no ven. No
          podés escribir y tu lectura no cambia los tildes.
        </span>
      </div>
      {reports.map((text) => (
        <div
          key={text}
          className="flex items-center gap-2.5 bg-danger-soft px-[18px] py-2.5 text-xs font-medium text-danger-fg"
        >
          <Flag aria-hidden className="size-3.5 flex-none" />
          <span>{text}</span>
        </div>
      ))}
      <div
        role="log"
        aria-label="Mensajes del envío"
        className="flex flex-1 flex-col overflow-auto px-[18px] pt-2 pb-5"
      >
        {hasMore && (
          <div className="flex flex-col items-center gap-1.5 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onMore}
            >
              {pending && <RotateCw aria-hidden className="animate-spin" />}
              Ver mensajes anteriores
            </Button>
            {failed && (
              <span role="alert" className="text-xs text-danger-fg">
                No pudimos cargar más mensajes ({failed}).
              </span>
            )}
          </div>
        )}
        {items.length === 0 && (
          <span className="m-auto text-[13px] text-muted-foreground">
            Todavía no hay mensajes.
          </span>
        )}
        {items.map((item) => {
          if (item.kind === "day")
            return (
              <div
                key={item.key}
                className="mt-4 self-center rounded-full bg-muted px-2.5 py-[3px] text-[11px] font-semibold text-fg2"
              >
                {item.label}
              </div>
            )
          if (item.kind === "event")
            return (
              <div
                key={item.key}
                className="mt-3 flex h-7 items-center gap-2 self-center rounded-full bg-lime/40 px-3 text-foreground"
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full bg-foreground"
                />
                <span className="text-xs font-semibold">{item.label}</span>
                <span className="text-[11px] font-medium opacity-75">
                  {item.time}
                </span>
              </div>
            )
          return (
            <div
              key={item.key}
              className={cn(
                "flex items-end gap-2",
                item.head ? "mt-3.5" : "mt-1"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-7 flex-none items-center justify-center rounded-full bg-avatar text-[10px] font-semibold",
                  !item.head && "invisible"
                )}
              >
                {initialsOf(item.name)}
              </span>
              <div className="flex max-w-[80%] flex-col gap-[3px]">
                {item.head && (
                  <span className="px-1 pt-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                    {item.name}
                    {item.role && ` · ${item.role}`}
                  </span>
                )}
                <div className="rounded-[20px_20px_20px_6px] border bg-muted px-3.5 py-2.5 text-sm leading-[1.45] text-pretty whitespace-pre-wrap">
                  {item.message.body}
                </div>
                <span className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
                  {item.time}
                  {item.message.moderated && (
                    <span className="inline-flex h-4 items-center rounded-full bg-warn-soft px-1.5 font-semibold text-warn-fg">
                      Filtro de lenguaje
                    </span>
                  )}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2.5 border-t px-[18px] py-3.5 text-[13px] text-muted-foreground">
        <Lock aria-hidden className="size-4 flex-none" />
        <span>
          Solo lectura · el equipo de Movo no escribe en los chats de envíos
        </span>
      </div>
    </>
  )
}
