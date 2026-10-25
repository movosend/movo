"use client"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { ArrowRightLeft, CircleCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ShipmentStatusValue } from "@/lib/shipments/format"
import { recipientsText, statusLabel } from "./copy"
import { StatusChangeDialog } from "./status-change-dialog"
import type { StatusChangeDone } from "./use-status-change"

interface Notice {
  code: string
  to: ShipmentStatusValue
  recipients: string
}

const Ctx = createContext<{
  openDialog: () => void
  notice: Notice | null
  dismissNotice: () => void
} | null>(null)

function useStatusChangeContext() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("Falta StatusChangeProvider")
  return ctx
}

/**
 * Une el botón del encabezado, el modal y el aviso del resultado (MOVO-333). El detalle se actualiza solo: la
 * acción del servidor revalida la página al terminar bien.
 */
export function StatusChangeProvider({
  shipmentId,
  displayCode,
  currentStatus,
  children,
}: {
  shipmentId: string
  displayCode: string
  currentStatus: ShipmentStatusValue
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const onDone = useCallback((done: StatusChangeDone) => {
    setOpen(false)
    setNotice({
      code: done.code,
      to: done.to,
      recipients: recipientsText(done.option.notifies).toLowerCase(),
    })
  }, [])
  const value = useMemo(
    () => ({
      openDialog: () => {
        setNotice(null)
        setOpen(true)
      },
      notice,
      dismissNotice: () => setNotice(null),
    }),
    [notice]
  )
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && (
        <StatusChangeDialog
          shipmentId={shipmentId}
          displayCode={displayCode}
          currentStatus={currentStatus}
          onOpenChange={setOpen}
          onDone={onDone}
        />
      )}
    </Ctx.Provider>
  )
}

/**
 * "Cambiar estado" del encabezado. Si el admin es parte del envío queda deshabilitado y la razón se ve debajo (no
 * en un tooltip: no depende del hover); el backend igual rechaza con `ADMIN_CONFLICT_OF_INTEREST`.
 */
export function StatusChangeButton({ conflict }: { conflict: boolean }) {
  const { openDialog } = useStatusChangeContext()
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        type="button"
        variant="outline"
        disabled={conflict}
        aria-describedby={conflict ? "status-change-blocked" : undefined}
        onClick={openDialog}
      >
        <ArrowRightLeft aria-hidden data-icon="inline-start" />
        Cambiar estado
      </Button>
      {conflict && (
        <p
          id="status-change-blocked"
          className="max-w-[260px] text-right text-xs text-muted-foreground"
        >
          Sos parte de este envío, así que no podés cambiarle el estado. Pedile
          a otro admin.
        </p>
      )}
    </div>
  )
}

/** Aviso de que el cambio se aplicó y a quién se avisó. */
export function StatusChangeNotice() {
  const { notice, dismissNotice } = useStatusChangeContext()
  if (!notice) return null
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[10px] border border-[var(--success-border,var(--border))] bg-success-soft px-3.5 py-3 text-sm leading-[1.45] text-success-fg"
    >
      <CircleCheck aria-hidden className="mt-0.5 size-4 flex-none" />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">
          #{notice.code} pasó a {statusLabel(notice.to)}.
        </strong>{" "}
        Quedó en la línea de tiempo y en la bitácora. Avisamos a:{" "}
        {notice.recipients}.
      </p>
      <button
        type="button"
        aria-label="Cerrar aviso"
        onClick={dismissNotice}
        className="flex size-6 flex-none items-center justify-center rounded-md outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  )
}
