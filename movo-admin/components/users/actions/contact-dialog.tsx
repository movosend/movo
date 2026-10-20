"use client"
import { useState, useTransition } from "react"
import { ArrowDown } from "lucide-react"
import type {
  AdminContactField,
  AdminContactUpdateResult,
  AdminUserProfile,
} from "@movo/shared/src/types/admin-users"
import { updateContact } from "@/app/users/[id]/account-actions"
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
import { displayContact, normalizeContact } from "@/lib/users/contact"
import {
  AckCheck,
  ActionError,
  Consequences,
  DoneState,
  ReasonField,
} from "./fields"

const COPY: Record<
  AdminContactField,
  { title: string; label: string; placeholder: string; noun: string }
> = {
  email: {
    title: "Cambiar el email",
    label: "Email nuevo",
    placeholder: "nombre@dominio.com",
    noun: "email",
  },
  phone: {
    title: "Cambiar el teléfono",
    label: "Teléfono nuevo",
    placeholder: "351 612-4410",
    noun: "teléfono",
  },
}

export function ContactDialog({
  field,
  onClose,
  user,
}: {
  /** `null` = cerrado. */
  field: AdminContactField | null
  onClose: () => void
  user: AdminUserProfile
}) {
  // Se recuerda el último campo para que el título no parpadee mientras el diálogo se cierra.
  const [last, setLast] = useState<AdminContactField>("email")
  if (field && field !== last) setLast(field)
  const shown = field ?? last
  return (
    <Dialog open={field !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{COPY[shown].title}</DialogTitle>
        </DialogHeader>
        <ContactForm key={shown} field={shown} user={user} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function ContactForm({
  field,
  user,
  onClose,
}: {
  field: AdminContactField
  user: AdminUserProfile
  onClose: () => void
}) {
  const copy = COPY[field]
  // Lo que el admin vio al abrir: viaja como `expectedCurrent` y no cambia aunque la ficha se refresque.
  const [current] = useState(field === "email" ? user.email : user.phone)
  const [step, setStep] = useState<"edit" | "confirm" | "done">("edit")
  const [value, setValue] = useState("")
  const [reason, setReason] = useState("")
  const [ack, setAck] = useState(false)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<{
    message: string
    stale: boolean
  } | null>(null)
  const [result, setResult] = useState<AdminContactUpdateResult | null>(null)
  const [pending, start] = useTransition()

  const normalized = normalizeContact(field, value)
  const unchanged = normalized !== null && normalized === current
  const invalid = touched && value.trim() !== "" && normalized === null
  const canReview =
    normalized !== null && !unchanged && reason.trim().length > 0

  const submit = () =>
    start(async () => {
      if (!normalized) return
      setError(null)
      const response = await updateContact(user.id, {
        field,
        newValue: normalized,
        expectedCurrent: current,
        reason,
      })
      if (!response.ok)
        return setError({
          message: response.error,
          stale: response.code === "CONTACT_CHANGED",
        })
      setResult(response.data)
      setStep("done")
    })

  if (step === "done" && result)
    return (
      <DoneState
        title={`${field === "email" ? "Email" : "Teléfono"} actualizado`}
        lines={[
          `Ahora es ${displayContact(field, field === "email" ? result.email : result.phone)}.`,
          `Queda sin verificar: ${user.fullName} lo confirma con un código.`,
          "Cerramos sus sesiones y quedó en la bitácora.",
        ]}
        onClose={onClose}
      />
    )

  if (step === "confirm" && normalized)
    return (
      <>
        <DialogBody>
          <div className="flex flex-col gap-1 rounded-lg border p-3.5">
            <span className="text-xs text-muted-foreground">
              {user.fullName} · {copy.noun}
            </span>
            <span className="text-sm break-all text-fg2 line-through">
              {displayContact(field, current)}
            </span>
            <ArrowDown
              aria-hidden
              className="my-0.5 size-4 text-muted-foreground"
            />
            <span className="text-[15px] font-semibold break-all">
              {displayContact(field, normalized)}
            </span>
          </div>
          <Consequences
            items={
              field === "email"
                ? [
                    "Se cierran todas sus sesiones: tiene que volver a iniciar sesión.",
                    "El email nuevo queda sin verificar y lo confirma con un código.",
                    <>
                      Avisamos del cambio a{" "}
                      <strong className="font-medium">{current}</strong> y al
                      email nuevo.
                    </>,
                    "Queda en la bitácora con tu nombre y el motivo. Para revertirlo hay que repetir esta acción.",
                  ]
                : [
                    "Se cierran todas sus sesiones: tiene que volver a iniciar sesión.",
                    "Desde ahora entra a la app con el teléfono nuevo.",
                    "El teléfono nuevo queda sin verificar: lo confirma con un código por SMS y, hasta entonces, no puede iniciar la verificación de identidad (KYC).",
                    <>
                      Avisamos del cambio por email a{" "}
                      <strong className="font-medium">{user.email}</strong>.
                    </>,
                    "Queda en la bitácora con tu nombre y el motivo. Para revertirlo hay que repetir esta acción.",
                  ]
            }
          />
          <AckCheck checked={ack} onChange={setAck} disabled={pending}>
            Entiendo que esto cambia cómo entra {user.firstName} a su cuenta.
          </AckCheck>
          <ActionError message={error?.message ?? null} />
        </DialogBody>
        <DialogFooter>
          {error?.stale ? (
            <Button type="button" onClick={onClose}>
              Cerrar
            </Button>
          ) : (
            <>
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
                {pending ? "Cambiando…" : `Cambiar ${copy.noun}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </>
    )

  return (
    <>
      <DialogBody>
        <div className="flex flex-col gap-1 rounded-lg bg-muted px-3.5 py-3">
          <span className="text-xs text-muted-foreground">
            {copy.noun[0].toUpperCase() + copy.noun.slice(1)} actual
          </span>
          <span className="text-sm font-medium break-all">
            {displayContact(field, current)}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="contact-value" className="text-[13px] font-medium">
            {copy.label}
          </label>
          <Input
            id="contact-value"
            value={value}
            autoFocus
            inputMode={field === "phone" ? "tel" : "email"}
            autoComplete="off"
            placeholder={copy.placeholder}
            aria-invalid={invalid || unchanged}
            onBlur={() => setTouched(true)}
            onChange={(e) => setValue(e.target.value)}
          />
          <span
            className="min-h-4 text-xs text-muted-foreground"
            role={invalid || unchanged ? "alert" : undefined}
          >
            {unchanged
              ? `Es el mismo ${copy.noun} que ya tiene.`
              : invalid
                ? field === "email"
                  ? "Ingresá un email válido."
                  : "Ingresá un teléfono argentino válido, con código de área."
                : normalized && field === "phone"
                  ? `Se guarda como ${displayContact(field, normalized)}.`
                  : field === "phone"
                    ? "Con código de área, sin 0 ni 15. Ej. 351 612-4410."
                    : ""}
          </span>
        </div>
        <ReasonField
          id="contact-reason"
          value={reason}
          onChange={setReason}
          placeholder="Por qué se cambia (ej. pidió el cambio por soporte tras validar identidad)"
        />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={!canReview}
          onClick={() => setStep("confirm")}
        >
          Revisar cambio
        </Button>
      </DialogFooter>
    </>
  )
}
