"use client"
import Link from "next/link"
import { useActionState, useEffect, useState } from "react"
import { ArrowLeft, Eye, EyeOff, LoaderCircle } from "lucide-react"
import {
  requestReset,
  verifyResetCode,
  resendResetCode,
  setNewPassword,
  cancelReset,
} from "@/app/forgot/actions"
import type { AuthState } from "@/app/login/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brand } from "@/components/brand"
import { IdentifierField } from "@/components/identifier-field"
import { ThemeToggle } from "@/components/theme-toggle"

type Step = "identify" | "code" | "password"
const ACTIONS = {
  identify: requestReset,
  code: verifyResetCode,
  password: setNewPassword,
}
const COPY = {
  identify: {
    title: "Recuperá tu contraseña",
    submit: "Enviar código",
  },
  code: { title: "Ingresá el código", submit: "Verificar" },
  password: {
    title: "Elegí una contraseña nueva",
    submit: "Cambiar contraseña",
  },
}

export function ForgotForm({
  step,
  flow,
}: {
  step: Step
  flow?: { target: string; channel: "sms" | "email"; resendAt: number }
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    ACTIONS[step],
    {}
  )
  const [resendState, resendAction, resending] = useActionState<
    AuthState,
    FormData
  >(resendResetCode, {})
  const [now, setNow] = useState(0)
  const [code, setCode] = useState("")
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (step !== "code") return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [step])
  const seconds = Math.max(
    0,
    Math.ceil(((resendState.resendAt ?? flow?.resendAt ?? 0) - now) / 1000)
  )
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  const copy = COPY[step]
  return (
    <main className="auth-canvas">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <div className="auth-container">
        <div className="auth-card">
          {step === "identify" ? (
            <Link href="/login" className="auth-back">
              <ArrowLeft aria-hidden />
              Volver a ingresar
            </Link>
          ) : (
            <form action={cancelReset}>
              <button type="submit" className="auth-back" disabled={pending}>
                <ArrowLeft aria-hidden />
                Empezar de nuevo
              </button>
            </form>
          )}
          <Brand />
          <div className="auth-heading">
            <h1>{copy.title}</h1>
            <p>
              {step === "identify" &&
                "Te enviamos un código para elegir una contraseña nueva. Solo para cuentas con acceso al panel."}
              {step === "code" && flow && (
                <>
                  Te enviamos un código de 6 dígitos{" "}
                  {flow.channel === "sms" ? "por SMS al " : "a "}
                  <span className="auth-mono">{flow.target}</span>. Vence en 10
                  minutos.
                </>
              )}
              {step === "password" &&
                "Mínimo 8 caracteres, con letras y números. Se cierran tus sesiones activas."}
            </p>
          </div>
          <form action={action} aria-busy={pending}>
            <FieldGroup>
              {step === "identify" && (
                <IdentifierField pending={pending} invalid={!!state.error} />
              )}
              {step === "code" && (
                <Field data-invalid={!!state.error}>
                  <FieldLabel htmlFor="code" className="sr-only">
                    Código de verificación
                  </FieldLabel>
                  <InputOTP
                    id="code"
                    name="code"
                    maxLength={6}
                    pattern="^[0-9]*$"
                    pasteTransformer={(value) => value.replace(/\s/g, "")}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={setCode}
                    disabled={pending}
                    aria-invalid={!!state.error}
                    required
                  >
                    <InputOTPGroup className="auth-otp">
                      {Array.from({ length: 6 }, (_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </Field>
              )}
              {step === "password" && (
                <>
                  <Field data-invalid={!!state.error}>
                    <FieldLabel htmlFor="password">Contraseña nueva</FieldLabel>
                    <div className="auth-password">
                      <Input
                        id="password"
                        name="password"
                        type={show ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        minLength={8}
                        maxLength={1024}
                        disabled={pending}
                        aria-invalid={!!state.error}
                      />
                      <button
                        type="button"
                        className="auth-reveal"
                        aria-label={
                          show ? "Ocultar contraseña" : "Mostrar contraseña"
                        }
                        aria-pressed={show}
                        onClick={() => setShow((v) => !v)}
                      >
                        {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      </button>
                    </div>
                  </Field>
                  <Field data-invalid={!!state.error}>
                    <FieldLabel htmlFor="confirm">Repetila</FieldLabel>
                    <Input
                      id="confirm"
                      name="confirm"
                      type={show ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      maxLength={1024}
                      disabled={pending}
                      aria-invalid={!!state.error}
                    />
                  </Field>
                </>
              )}
              {state.error && (
                <Alert variant="destructive">
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                disabled={pending || (step === "code" && code.length !== 6)}
              >
                {pending ? (
                  <>
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                    Verificando…
                  </>
                ) : (
                  copy.submit
                )}
              </Button>
            </FieldGroup>
          </form>
          {step === "code" && (
            <>
              <form action={resendAction} className="auth-resend">
                <span>¿No te llegó?</span>
                {seconds > 0 ? (
                  <span>
                    Podés pedir otro en{" "}
                    <span className="auth-mono">{now ? clock : "…"}</span>
                  </span>
                ) : (
                  <button
                    type="submit"
                    className="auth-link"
                    disabled={resending || pending}
                  >
                    {resending ? "Enviando…" : "Reenviar código"}
                  </button>
                )}
              </form>
              {(resendState.error || resendState.notice) && (
                <Alert>
                  <AlertDescription>
                    {resendState.error || resendState.notice}
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>
        <p className="auth-foot">
          <span className="auth-mono">admin.movosend.app</span>
          <span aria-hidden>·</span>
          Solo para el equipo de Movo
        </p>
      </div>
    </main>
  )
}
