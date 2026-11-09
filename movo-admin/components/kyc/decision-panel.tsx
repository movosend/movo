"use client"
import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { Check, X } from "lucide-react"
import {
  ADMIN_KYC_DECISION_REASON_MAX_LENGTH,
  ADMIN_KYC_DECISION_REASON_MIN_LENGTH,
  type AdminKycDecision,
} from "@movo/shared/src/types/admin-kyc"
import { decideKyc } from "@/app/kyc/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ActionError,
  Consequences,
  DoneState,
  ReasonField,
} from "@/components/users/actions/fields"
import { KYC_TYPE_LABEL } from "@/lib/kyc/format"

type Props = {
  sessionId: string
  fullName: string
  verificationType: "identity" | "license"
}

/** Aprobar y rechazar un caso en revisión: cada botón abre un diálogo que pide el motivo. */
/** Atajo de teclado en el botón, como en Didit. */
function Kbd({ children }: { children: string }) {
  return (
    <kbd className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-current/25 px-1 font-sans text-[11px] leading-none font-medium opacity-70">
      {children}
    </kbd>
  )
}

/** Un atajo no vale mientras se escribe ni con otro diálogo abierto (por ejemplo, el visor de fotos). */
function shortcutBlocked(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return true
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return true
  return document.querySelector("[data-slot='dialog-content']") !== null
}

export function DecisionPanel(props: Props) {
  const [open, setOpen] = useState<AdminKycDecision | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (open || shortcutBlocked(event)) return
      const key = event.key.toLowerCase()
      if (key === "a") {
        event.preventDefault()
        setOpen("approved")
      } else if (key === "d") {
        event.preventDefault()
        setOpen("rejected")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => setOpen("rejected")}
          aria-keyshortcuts="D"
        >
          <X aria-hidden data-icon="inline-start" /> Rechazar <Kbd>D</Kbd>
        </Button>
        <Button type="button" size="lg" onClick={() => setOpen("approved")} aria-keyshortcuts="A">
          <Check aria-hidden data-icon="inline-start" /> Aprobar <Kbd>A</Kbd>
        </Button>
      </div>
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent aria-describedby={undefined}>
          {open && (
            <DecisionForm
              key={open}
              {...props}
              decision={open}
              onClose={() => setOpen(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function DecisionForm({
  sessionId,
  fullName,
  verificationType,
  decision,
  onClose,
}: Props & { decision: AdminKycDecision; onClose: () => void }) {
  const approve = decision === "approved"
  const what = KYC_TYPE_LABEL[verificationType].toLowerCase()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()
  const valid = reason.trim().length >= ADMIN_KYC_DECISION_REASON_MIN_LENGTH

  const submit = () =>
    start(async () => {
      setError(null)
      const result = await decideKyc(sessionId, decision, reason)
      if (!result.ok) return setError(result.error)
      setDone(true)
    })

  if (done)
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {approve ? "Verificación aprobada" : "Verificación rechazada"}
          </DialogTitle>
        </DialogHeader>
        <DoneState
          title={approve ? "Quedó aprobada" : "Quedó rechazada"}
          lines={[
            `${fullName} recibe el aviso en la app.`,
            "Quedó en la bitácora con tu nombre.",
          ]}
          onClose={onClose}
        />
        <div className="px-5 pb-4">
          <Link
            href="/kyc"
            className="text-sm font-medium underline underline-offset-4"
          >
            Volver a la cola
          </Link>
        </div>
      </>
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {approve ? "Aprobar" : "Rechazar"} {what} de {fullName}
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Consequences
          items={
            approve
              ? [
                  `Didit marca la sesión como aprobada y ${fullName} queda con ${what} verificada.`,
                  "Recibe un aviso en la app.",
                  ...(verificationType === "license"
                    ? ["Se registra su licencia como vigente."]
                    : []),
                ]
              : [
                  "Didit marca la sesión como rechazada.",
                  "Recibe un aviso en la app y puede volver a intentarlo con una verificación nueva.",
                ]
          }
        />
        <ReasonField
          id="kyc-reason"
          value={reason}
          onChange={setReason}
          disabled={pending}
          autoFocus
          max={ADMIN_KYC_DECISION_REASON_MAX_LENGTH}
          min={ADMIN_KYC_DECISION_REASON_MIN_LENGTH}
          hint="Queda en Didit y en la bitácora. No pegues datos del documento."
          placeholder={
            approve
              ? "Por qué se aprueba (ej. el documento es legible y coincide con la selfie)"
              : "Por qué se rechaza (ej. el documento está vencido)"
          }
        />
        <ActionError message={error} />
      </DialogBody>
      <DialogFooter>
        {!valid && !pending && (
          // Por qué el botón está apagado, a la vista y no solo en un tooltip.
          <span className="mr-auto self-center text-xs text-muted-foreground">
            Escribí el motivo para {approve ? "aprobar" : "rechazar"}
          </span>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant={approve ? "default" : "destructive"}
          disabled={pending || !valid}
          onClick={submit}
        >
          {pending
            ? approve
              ? "Aprobando…"
              : "Rechazando…"
            : approve
              ? "Aprobar"
              : "Rechazar"}
        </Button>
      </DialogFooter>
    </>
  )
}
