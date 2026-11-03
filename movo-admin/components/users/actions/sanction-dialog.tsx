"use client"
import { useState, useTransition } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import {
  ACCOUNT_SANCTION_NOTE_MAX_LENGTH,
  ACCOUNT_SANCTION_REASON_MAX_LENGTH,
  type AccountSanctionType,
} from "@movo/shared/src/types/account-sanctions"
import type { InProgressShipment } from "@movo/shared/src/types/admin"
import type {
  AdminSanctionPreview,
  AdminUserSanction,
} from "@movo/shared/src/types/admin-users"
import {
  applySanction,
  loadSanctionPreview,
} from "@/app/users/[id]/account-actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { formatDay, SHIPMENT_STATUS } from "@/lib/users/format"
import { describePreview, describeWithdrawn } from "@/lib/users/sanctions"
import { Segmented } from "../segmented"
import { StatusPill } from "../ui"
import {
  AckCheck,
  ActionError,
  Consequences,
  DoneState,
  ReasonField,
} from "./fields"
import { RetryWithdrawalButton } from "./retry-withdrawal-button"

const TITLE: Record<AccountSanctionType, string> = {
  suspension: "Suspender la cuenta",
  disable: "Inhabilitar la cuenta",
}

const ROLE: Record<InProgressShipment["userRole"], string> = {
  sender: "emisor",
  carrier: "transportista",
  receiver: "receptor",
}

/** Mañana en Argentina, `YYYY-MM-DD`: la fecha de fin más cercana que se puede elegir. */
const tomorrow = () =>
  new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Cordoba",
  })

/**
 * Suspender o inhabilitar (MOVO-299 AC6). Dos pasos: el formulario y la confirmación, que trae la
 * vista previa de lo que se va a retirar. Inhabilitar con envíos en curso no se aplica: se muestran
 * los envíos y se sugiere suspender primero.
 */
export function SanctionDialog({
  type,
  onClose,
  userId,
  fullName,
}: {
  type: AccountSanctionType | null
  onClose: () => void
  userId: string
  fullName: string
}) {
  return (
    <Dialog open={type !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{type ? TITLE[type] : ""}</DialogTitle>
        </DialogHeader>
        {type && (
          <SanctionForm
            key={type}
            type={type}
            userId={userId}
            fullName={fullName}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SanctionForm({
  type,
  userId,
  fullName,
  onClose,
}: {
  type: AccountSanctionType
  userId: string
  fullName: string
  onClose: () => void
}) {
  const [step, setStep] = useState<
    "edit" | "confirm" | "blocked" | "unconfirmed" | "done"
  >("edit")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [term, setTerm] = useState<"until" | "indefinite">("until")
  const [endsOn, setEndsOn] = useState("")
  const [ack, setAck] = useState(false)
  const [preview, setPreview] = useState<AdminSanctionPreview | null>(null)
  const [blockers, setBlockers] = useState<InProgressShipment[]>([])
  const [applied, setApplied] = useState<AdminUserSanction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const suspension = type === "suspension"
  const needsDate = suspension && term === "until"
  const canReview = reason.trim() !== "" && (!needsDate || endsOn >= tomorrow())

  const review = () =>
    start(async () => {
      setError(null)
      const response = await loadSanctionPreview(userId)
      if (!response.ok) return setError(response.error)
      // Inhabilitar con envíos en curso no se aplica (AC3): se ve antes de confirmar, no después.
      if (!suspension && response.data.inProgressShipments.length > 0) {
        setBlockers(response.data.inProgressShipments)
        return setStep("blocked")
      }
      setPreview(response.data)
      setStep("confirm")
    })

  const submit = () =>
    start(async () => {
      setError(null)
      const response = await applySanction(userId, {
        type,
        reason,
        internalNote: note,
        endsOn: needsDate ? endsOn : null,
      })
      if (!response.ok) {
        // Un envío que aparece entre la vista previa y la confirmación lo rechaza el backend; uno que se
        // compromete entre su chequeo y la sanción, no (carrera aceptada, DD-049).
        if (response.inProgressShipments) {
          setBlockers(response.inProgressShipments)
          return setStep("blocked")
        }
        // Puede haberse aplicado: reintentar abriría una segunda sanción y cerraría la primera como
        // reemplazada. Se cierra el paso de confirmación y se manda a la ficha, que ya se refrescó.
        if (response.unconfirmed) return setStep("unconfirmed")
        return setError(response.error)
      }
      setApplied(response.data)
      setStep("done")
    })

  if (step === "done" && applied) {
    const w = applied.withdrawal
    const ok = w?.status === "complete"
    return (
      <>
        <DoneState
          title={suspension ? "Cuenta suspendida" : "Cuenta inhabilitada"}
          lines={[
            suspension
              ? applied.endsAt
                ? `${fullName} no puede publicar, ofertar ni declarar viajes hasta el ${formatDay(applied.endsAt)}.`
                : `${fullName} no puede publicar, ofertar ni declarar viajes hasta que se levante la suspensión.`
              : `${fullName} ya no puede iniciar sesión.`,
            ok && w.result
              ? describeWithdrawn(w.result)
              : "La sanción ya está aplicada, pero no se pudo retirar todo lo abierto.",
            "Quedó en la bitácora.",
          ]}
          onClose={onClose}
        />
        {!ok && (
          <div className="flex flex-col gap-2.5 border-t px-5 py-4">
            <span className="flex items-start gap-2 text-[13px] text-warn-fg">
              <TriangleAlert aria-hidden className="mt-px size-4 flex-none" />
              {w?.status === "partial"
                ? "Algunas publicaciones, ofertas o viajes no se pudieron retirar."
                : "El servicio de envíos no respondió."}{" "}
              Reintentá el retiro: solo toma lo que sigue abierto.
            </span>
            <RetryWithdrawalButton userId={userId} sanctionId={applied.id} />
          </div>
        )}
      </>
    )
  }

  if (step === "unconfirmed")
    return (
      <>
        <DialogBody>
          <ActionError message="El servicio no respondió y no sabemos si la sanción se aplicó." />
          <p className="text-[13px] text-fg2">
            Cerrá el diálogo y revisá la ficha: si la sanción figura como
            vigente, ya está aplicada (y si el retiro quedó pendiente, se
            reintenta desde ahí). Si no figura, volvé a intentarlo.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar y revisar la ficha
          </Button>
        </DialogFooter>
      </>
    )

  if (step === "blocked")
    return (
      <>
        <DialogBody>
          <ActionError
            message={`${fullName} tiene ${blockers.length === 1 ? "un envío en curso" : `${blockers.length} envíos en curso`}: no se puede inhabilitar ahora.`}
          />
          <ul className="flex flex-col divide-y rounded-lg border">
            {blockers.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 px-3.5 py-2.5 text-[13px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/shipments/${s.id}`}
                    className="font-mono text-xs font-medium underline underline-offset-4"
                  >
                    {s.shortId}
                  </Link>
                  <StatusPill pill={SHIPMENT_STATUS[s.status]} />
                  <span className="text-xs text-muted-foreground">
                    como {ROLE[s.userRole]}
                  </span>
                </div>
                <span className="text-fg2">
                  {s.pickupAddress} → {s.deliveryAddress}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-fg2">
            Suspendé la cuenta primero: no puede tomar nada nuevo y los envíos
            en curso terminan. Cuando no quede ninguno, inhabilitala.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </>
    )

  if (step === "confirm" && preview)
    return (
      <>
        <DialogBody>
          <Consequences
            items={[
              suspension
                ? needsDate
                  ? `${fullName} no puede publicar, ofertar ni declarar viajes hasta el ${formatDay(`${endsOn}T12:00:00-03:00`)} inclusive.`
                  : `${fullName} no puede publicar, ofertar ni declarar viajes hasta que se levante la suspensión.`
                : `${fullName} no puede volver a iniciar sesión. Es permanente: solo se revierte levantando la sanción.`,
              ...describePreview(preview),
              "Recibe un aviso con el motivo, en la app y por email.",
            ]}
          />
          <AckCheck checked={ack} onChange={setAck} disabled={pending}>
            {suspension
              ? "Confirmo la suspensión y el motivo que va a ver la persona."
              : "Confirmo la inhabilitación y el motivo que va a ver la persona."}
          </AckCheck>
          <ActionError message={error} />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null)
              setAck(false)
              setStep("edit")
            }}
          >
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!ack || pending}
            onClick={submit}
          >
            {pending ? "Aplicando…" : suspension ? "Suspender" : "Inhabilitar"}
          </Button>
        </DialogFooter>
      </>
    )

  return (
    <>
      <DialogBody>
        <ReasonField
          id="sanction-reason"
          value={reason}
          onChange={setReason}
          disabled={pending}
          autoFocus
          max={ACCOUNT_SANCTION_REASON_MAX_LENGTH}
          hint="Lo ve la persona en la app y en el email. Escribilo para ella."
          placeholder="Ej. Tres reportes por no presentarse a retirar envíos asignados."
        />
        <ReasonField
          id="sanction-note"
          value={note}
          onChange={setNote}
          disabled={pending}
          max={ACCOUNT_SANCTION_NOTE_MAX_LENGTH}
          label="Nota interna (opcional)"
          hint="Solo para el panel y la bitácora. La persona no la ve."
          placeholder="Contexto para otros admins (reportes revisados, conversación con soporte…)"
        />
        {suspension && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Plazo</span>
            <div className="w-fit">
              <Segmented
                label="Plazo"
                value={term}
                onChange={setTerm}
                options={[
                  { value: "until", label: "Hasta una fecha" },
                  { value: "indefinite", label: "Indefinida" },
                ]}
              />
            </div>
            {term === "until" ? (
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Último día de la suspensión (termina a las 23:59)
                <Input
                  type="date"
                  value={endsOn}
                  min={tomorrow()}
                  disabled={pending}
                  onChange={(e) => setEndsOn(e.target.value)}
                  className="w-fit"
                />
              </label>
            ) : (
              <span className="text-xs text-muted-foreground">
                Sigue hasta que un admin la levante.
              </span>
            )}
          </div>
        )}
        <ActionError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="button" disabled={!canReview || pending} onClick={review}>
          {pending ? "Revisando…" : "Revisar"}
        </Button>
      </DialogFooter>
    </>
  )
}
