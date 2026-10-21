"use client"
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Info, Lock, RotateCw, TriangleAlert, X } from "lucide-react"
import type {
  SupportAttachment,
  SupportMessage,
} from "@movo/shared/src/types/admin-support"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import { dayLabel, firstName, formatClock, sameDay } from "../format"

/** Mensaje que todavía no confirmó el servidor (UI optimista) o que no se pudo enviar. */
export type DisplayMessage = SupportMessage & {
  pending?: { state: "sending" | "failed"; error?: string }
}

const NEAR_BOTTOM_PX = 120

function Images({
  attachments,
  onOpen,
}: {
  attachments: SupportAttachment[]
  onOpen: (a: SupportAttachment) => void
}) {
  if (!attachments.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpen(a)}
          aria-label="Ampliar imagen adjunta"
          className="overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={a.url}
            alt="Imagen adjunta"
            loading="lazy"
            width={a.width}
            height={a.height}
            className="block max-h-40 w-auto max-w-[220px] object-cover"
          />
        </button>
      ))}
    </div>
  )
}

function Lightbox({
  image,
  onClose,
}: {
  image: SupportAttachment | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(92vw,960px)] items-center border-0 bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">Imagen adjunta</DialogTitle>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt="Imagen adjunta ampliada"
            className="max-h-[85vh] w-auto max-w-full rounded-lg bg-card object-contain"
          />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar imagen"
          className="absolute -top-3 -right-3 flex size-8 items-center justify-center rounded-full bg-card text-foreground shadow-(--shadow-3) outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </DialogContent>
    </Dialog>
  )
}

function Delivery({
  message,
  onRetry,
  onDiscard,
}: {
  message: DisplayMessage
  onRetry: (clientMessageId: string) => void
  onDiscard: (clientMessageId: string) => void
}) {
  if (!message.pending) return null
  const id = message.clientMessageId ?? message.id
  if (message.pending.state === "sending")
    return (
      <span className="px-1 text-[11px] text-muted-foreground">Enviando…</span>
    )
  return (
    <span
      role="alert"
      className="flex flex-wrap items-center justify-end gap-2 px-1 text-[11px] text-danger-fg"
    >
      <TriangleAlert aria-hidden className="size-3" />
      {message.pending.error ?? "No se envió."}
      <button
        type="button"
        onClick={() => onRetry(id)}
        className="flex items-center gap-1 font-medium underline"
      >
        <RotateCw aria-hidden className="size-3" />
        Reintentar
      </button>
      <button
        type="button"
        onClick={() => onDiscard(id)}
        className="font-medium underline"
      >
        Descartar
      </button>
    </span>
  )
}

/**
 * Mensajes de la conversación (AC7): burbujas del usuario y de agentes agrupadas por autor, notas
 * internas diferenciadas (fondo de advertencia, candado), eventos de sistema, separadores de día e
 * imágenes con vista ampliada. Mantiene el scroll abajo cuando llegan mensajes y estás al final, y
 * la posición al traer anteriores.
 */
export function MessageList({
  messages,
  meId,
  userName,
  hasOlder,
  loadingOlder,
  olderError,
  onLoadOlder,
  onRetry,
  onDiscard,
  footer,
}: {
  messages: DisplayMessage[]
  meId: string
  userName: string
  hasOlder: boolean
  loadingOlder: boolean
  olderError: boolean
  onLoadOlder: () => void
  onRetry: (clientMessageId: string) => void
  onDiscard: (clientMessageId: string) => void
  footer?: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const before = useRef<number | null>(null)
  const [lightbox, setLightbox] = useState<SupportAttachment | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (before.current !== null) {
      el.scrollTop = el.scrollHeight - before.current
      before.current = null
    } else if (stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // Las imágenes cargan después y cambian el alto: si estaba abajo, se queda abajo.
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])

  const rendered: ReactNode[] = []
  let previousKey: string | null = null
  messages.forEach((m, i) => {
    const prev = messages[i - 1]
    if (!prev || !sameDay(prev.createdAt, m.createdAt)) {
      rendered.push(
        <div
          key={`day-${m.id}`}
          className="mx-auto mt-3 mb-1 self-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-fg2"
        >
          {dayLabel(m.createdAt)}
        </div>
      )
      previousKey = null
    }
    const time = formatClock(m.createdAt)
    if (m.kind === "system") {
      previousKey = null
      rendered.push(
        <div
          key={m.id}
          className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"
        >
          <Info aria-hidden className="size-[13px] shrink-0" />
          <span>
            {m.body} · {time}
          </span>
        </div>
      )
      return
    }
    const authorKey = m.kind === "user" ? "user" : `${m.kind}:${m.author.id}`
    const grouped = authorKey === previousKey
    previousKey = authorKey
    const mt = grouped ? "mt-1" : "mt-3.5"
    const who =
      m.kind === "user"
        ? firstName(userName)
        : m.author.id === meId
          ? "Vos"
          : firstName(m.author.fullName)
    if (m.kind === "user") {
      rendered.push(
        <div
          key={m.id}
          className={cn("flex max-w-[min(78%,560px)] items-end gap-2", mt)}
        >
          <UserAvatar name={userName} size={28} />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-col gap-1.5 rounded-[18px_18px_18px_6px] border bg-card px-3.5 py-2.5 text-sm leading-[1.45] text-pretty">
              {m.body && <span className="whitespace-pre-wrap">{m.body}</span>}
              <Images attachments={m.attachments} onOpen={setLightbox} />
            </div>
            <span className="px-1 text-[11px] text-muted-foreground">
              {time}
            </span>
          </div>
        </div>
      )
    } else if (m.kind === "agent") {
      rendered.push(
        <div
          key={m.id}
          className={cn(
            "flex max-w-[min(78%,560px)] flex-col items-end gap-1 self-end",
            mt,
            m.pending && "opacity-70"
          )}
        >
          <div className="flex flex-col items-end gap-1.5 rounded-[18px_18px_6px_18px] bg-primary px-3.5 py-2.5 text-sm leading-[1.45] text-pretty text-primary-foreground">
            {m.body && <span className="whitespace-pre-wrap">{m.body}</span>}
            <Images attachments={m.attachments} onOpen={setLightbox} />
          </div>
          <span className="px-1 text-[11px] text-muted-foreground">
            {who} · {time}
          </span>
          <Delivery message={m} onRetry={onRetry} onDiscard={onDiscard} />
        </div>
      )
    } else {
      rendered.push(
        <div
          key={m.id}
          className={cn(
            "mt-3 flex w-[min(78%,560px)] flex-col gap-1.5 self-end rounded-[10px] border border-dashed border-[var(--warn-border)] bg-warn-soft px-3.5 py-2.5",
            m.pending && "opacity-70"
          )}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-warn-fg uppercase">
            <Lock aria-hidden className="size-3" />
            Nota interna · {who} · {time}
          </span>
          {m.body && (
            <span className="text-sm leading-[1.45] text-pretty whitespace-pre-wrap">
              {m.body}
            </span>
          )}
          <Images attachments={m.attachments} onOpen={setLightbox} />
          <span className="text-[11px] text-warn-fg">Solo la ve el equipo</span>
          <Delivery message={m} onRetry={onRetry} onDiscard={onDiscard} />
        </div>
      )
    }
  })

  return (
    <>
      <div
        ref={scroller}
        role="log"
        aria-label="Mensajes de la conversación"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
        }}
        className="min-h-0 flex-1 overflow-auto px-6 pt-5 pb-3"
      >
        <div className="flex min-h-full flex-col">
          {hasOlder && (
            <div className="flex flex-col items-center gap-1 pb-2">
              {olderError && (
                <span role="alert" className="text-xs text-danger-fg">
                  No pudimos traer los mensajes anteriores.
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={loadingOlder}
                onClick={() => {
                  before.current = scroller.current?.scrollHeight ?? 0
                  onLoadOlder()
                }}
              >
                {loadingOlder
                  ? "Cargando…"
                  : olderError
                    ? "Reintentar"
                    : "Ver anteriores"}
              </Button>
            </div>
          )}
          {rendered}
          {footer}
        </div>
      </div>
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
