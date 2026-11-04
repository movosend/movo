"use client"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { AlertTriangle, Check } from "lucide-react"
import { cn } from "@/lib/utils"

/** Avisos de la reportería ("CSV listo", "Link copiado"), del prototipo: abajo a la derecha, 6 s, máximo 3. */
interface Toast {
  id: number
  title: string
  sub?: string
  tone?: "success" | "danger"
  action?: { label: string; run: () => void }
}

const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++next.current
    setToasts((prev) => [...prev, { ...toast, id }].slice(-3))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 6000)
    timers.current.add(timer)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-5 bottom-5 z-[80] flex flex-col items-end gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex w-[380px] max-w-[calc(100vw-40px)] items-start gap-3 rounded-[10px] border bg-card/90 px-3.5 py-3 shadow-[var(--shadow-4)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
          >
            <span
              className={cn(
                "flex size-6 flex-none items-center justify-center rounded-full",
                t.tone === "danger"
                  ? "bg-danger-soft text-danger-fg"
                  : "bg-success-soft text-success-fg"
              )}
            >
              {t.tone === "danger" ? (
                <AlertTriangle className="size-3.5" />
              ) : (
                <Check className="size-3.5" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{t.title}</span>
              {t.sub && (
                <span className="text-xs leading-snug break-words text-fg2">
                  {t.sub}
                </span>
              )}
            </span>
            {t.action && (
              <button
                type="button"
                onClick={t.action.run}
                className="h-7 rounded-md border border-border-strong px-2.5 text-xs font-medium whitespace-nowrap hover:bg-muted"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
