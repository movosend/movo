"use client"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"

/** Pestañas Email / Teléfono (+54 fijo) sobre un campo `identifier`; la elegida viaja como `method`. */
export function IdentifierField({
  pending,
  invalid,
}: {
  pending: boolean
  invalid: boolean
}) {
  const [method, setMethod] = useState<"email" | "phone">("email")
  return (
    <>
      <div role="tablist" aria-label="Ingresar con" className="auth-tabs">
        {(["email", "phone"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            id={`tab-${m}`}
            aria-selected={method === m}
            disabled={pending}
            onClick={() => setMethod(m)}
          >
            {m === "email" ? "Email" : "Teléfono"}
          </button>
        ))}
      </div>
      <input type="hidden" name="method" value={method} />
      <Field data-invalid={invalid}>
        <FieldLabel htmlFor="identifier">
          {method === "email" ? "Email" : "Teléfono"}
        </FieldLabel>
        <div className="auth-phone-row">
          {method === "phone" && (
            <span className="auth-prefix" aria-hidden>
              🇦🇷 +54
            </span>
          )}
          <Input
            key={method}
            id="identifier"
            name="identifier"
            type={method === "email" ? "email" : "tel"}
            autoComplete={method === "email" ? "username" : "tel-national"}
            placeholder={
              method === "email" ? "nombre@email.com" : "351 123 4567"
            }
            required
            maxLength={254}
            disabled={pending}
            aria-invalid={invalid}
          />
        </div>
      </Field>
    </>
  )
}
