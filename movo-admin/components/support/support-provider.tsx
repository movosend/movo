"use client"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { requestRealtimeTicket } from "@/app/support/actions"
import { supportClient } from "@/lib/support/client"
import {
  SupportFeed,
  type FeedMessage,
  type FeedStatus,
} from "@/lib/support/realtime/feed"
import { openSupportSocket } from "@/lib/support/realtime/socket"

interface Toast {
  key: number
  title: string
  body: string
  href: string
}

interface SupportContextValue {
  status: FeedStatus
  /** `null` hasta saber el total (o si el servicio no respondió): el badge no se muestra. */
  unread: number | null
  subscribe: (listener: (m: FeedMessage) => void) => () => void
  /** Cada shell montado pide la conexión; sin ninguno (login, etc.) se cierra. */
  retain: () => () => void
}

const noop = () => () => {}
const SupportContext = createContext<SupportContextValue>({
  status: "stopped",
  unread: null,
  subscribe: noop,
  retain: noop,
})

export const useSupport = () => useContext(SupportContext)

/** Pide la conexión en vivo mientras el componente esté montado (lo usa `AdminShell`). */
export function useSupportConnection() {
  const { retain } = useSupport()
  useEffect(() => retain(), [retain])
}

/** Recibe los eventos de la bandeja (WS o polling) y los `resync` tras recuperar la conexión. */
export function useSupportMessages(listener: (m: FeedMessage) => void) {
  const { subscribe } = useSupport()
  const ref = useRef(listener)
  useEffect(() => {
    ref.current = listener
  })
  useEffect(() => subscribe((m) => ref.current(m)), [subscribe])
}

const firstName = (name: string) => name.split(" ")[0] ?? name
const TOAST_MS = 6_000
/** Evita parpadeos al navegar entre pantallas: cada una monta su propio shell. */
const RELEASE_DELAY_MS = 1_500

/**
 * Una sola conexión en vivo por pestaña para todo el panel (AC2 y AC9 de MOVO-323): alimenta el
 * badge de "Soporte" en el menú, los toasts de consultas nuevas en cualquier pantalla y, por
 * `useSupportMessages`, la lista y la conversación abiertas.
 */
export function SupportProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const pathRef = useRef(pathname)
  const [status, setStatus] = useState<FeedStatus>("stopped")
  const [unread, setUnread] = useState<number | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const holders = useRef(0)
  const release = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextKey = useRef(0)
  const listeners = useRef(new Set<(m: FeedMessage) => void>())
  const feed = useMemo(
    () =>
      new SupportFeed({
        requestTicket: async () => {
          const result = await requestRealtimeTicket()
          return result.ok ? result.data : null
        },
        openSocket: (ticket) =>
          openSupportSocket(ticket, (since) =>
            supportClient.events(since).catch(() => null)
          ),
        fetchEvents: (since) => supportClient.events(since).catch(() => null),
        isVisible: () => document.visibilityState !== "hidden",
      }),
    []
  )

  useEffect(() => {
    pathRef.current = pathname
  }, [pathname])

  const toast = useCallback((title: string, body: string, href: string) => {
    const key = ++nextKey.current
    setToasts((all) => [...all.slice(-2), { key, title, body, href }])
    setTimeout(
      () => setToasts((all) => all.filter((t) => t.key !== key)),
      TOAST_MS
    )
  }, [])

  const loadUnread = useCallback(() => {
    supportClient
      .counts({ status: "open" })
      .then((counts) => setUnread(counts.unreadTotal))
      .catch(() => setUnread(null))
  }, [])

  useEffect(() => {
    const offStatus = feed.onStatus(setStatus)
    const off = feed.subscribe((message) => {
      if (message.type === "resync") loadUnread()
      else {
        const { event } = message
        if (event.type === "counts_updated") setUnread(event.counts.unreadTotal)
        else if (event.type === "conversation_created")
          toast(
            `Nueva consulta de ${firstName(event.conversation.user.fullName)}`,
            event.conversation.lastMessage?.body ?? "Abrir la conversación",
            `/support/${event.conversation.id}`
          )
        else if (
          event.type === "support_message" &&
          event.message.kind === "user" &&
          pathRef.current !== `/support/${event.conversationId}`
        )
          toast(
            `${firstName(event.conversation.user.fullName)} respondió`,
            event.message.body || "Te envió una imagen",
            `/support/${event.conversationId}`
          )
      }
      for (const listener of listeners.current) listener(message)
    })
    return () => {
      off()
      offStatus()
      feed.stop()
    }
  }, [feed, loadUnread, toast])

  const retain = useCallback(() => {
    holders.current++
    if (release.current) clearTimeout(release.current)
    release.current = null
    if (holders.current === 1 && feed.status === "stopped") {
      feed.start()
      loadUnread()
    }
    return () => {
      holders.current--
      if (holders.current > 0) return
      release.current = setTimeout(() => {
        if (holders.current === 0) feed.stop()
      }, RELEASE_DELAY_MS)
    }
  }, [feed, loadUnread])

  const subscribe = useCallback((listener: (m: FeedMessage) => void) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const value = useMemo(
    () => ({ status, unread, subscribe, retain }),
    [status, unread, subscribe, retain]
  )

  return (
    <SupportContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-5 z-80 flex w-[340px] max-w-[calc(100vw-40px)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setToasts((all) => all.filter((x) => x.key !== t.key))
              router.push(t.href)
            }}
            className="pointer-events-auto flex animate-in items-start gap-3 rounded-[10px] border bg-card/90 px-3.5 py-3 text-left shadow-(--shadow-4) backdrop-blur-md fade-in slide-in-from-bottom-2"
          >
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-lime shadow-(--lime-glow)" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-semibold">{t.title}</span>
              <span className="truncate text-[13px] text-fg2">{t.body}</span>
            </span>
          </button>
        ))}
      </div>
    </SupportContext.Provider>
  )
}
