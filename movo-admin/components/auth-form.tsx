"use client"
import Link from "next/link"
import { useActionState, useEffect, useState } from "react"
import { LoaderCircle, ArrowLeft, Eye, EyeOff } from "lucide-react"
import {
  login,
  verify,
  resend,
  changeAccount,
  type AuthState,
} from "@/app/login/actions"
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

export function AuthForm({
  challenge,
  notice,
  retrySession = false,
}: {
  challenge?: { email: string; resendAt: number }
  notice?: string
  retrySession?: boolean
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    challenge ? verify : login,
    {}
  )
  const [resendState, resendAction, resending] = useActionState<
    AuthState,
    FormData
  >(resend, {})
  const [now, setNow] = useState(0)
  const [code, setCode] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const hasChallenge = !!challenge
  useEffect(() => {
    if (!hasChallenge) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [hasChallenge])
  const seconds = Math.max(
    0,
    Math.ceil(((resendState.resendAt ?? challenge?.resendAt ?? 0) - now) / 1000)
  )
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  return (
    <main className="auth-canvas">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <div className="auth-container">
        <div className="auth-card">
          {challenge ? (
            <form action={changeAccount}>
              <button type="submit" className="auth-back" disabled={pending}>
                <ArrowLeft aria-hidden />
                Usar otra cuenta
              </button>
            </form>
          ) : (
            <Brand />
          )}
          <div className="auth-heading">
            <h1>{challenge ? "Revisá tu email" : "Panel de administración"}</h1>
            <p>
              {challenge ? (
                <>
                  Te enviamos un código de 6 dígitos a{" "}
                  <span className="auth-mono">{challenge.email}</span>. Vence en
                  10 minutos.
                </>
              ) : (
                "Ingresá con tu cuenta de Movo."
              )}
            </p>
          </div>
          {notice && (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {retrySession && (
            <Button variant="outline" render={<Link href="/" />}>
              Reintentar sesión
            </Button>
          )}
          <form action={action} aria-busy={pending}>
            <FieldGroup>
              {challenge ? (
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
              ) : (
                <>
                  <IdentifierField pending={pending} invalid={!!state.error} />
                  <Field data-invalid={!!state.error}>
                    <div className="auth-label-row">
                      <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                      <Link href="/forgot" className="auth-link">
                        ¿Olvidaste tu contraseña?
                      </Link>
                    </div>
                    <div className="auth-password">
                      <Input
                        id="password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        maxLength={1024}
                        disabled={pending}
                        aria-invalid={!!state.error}
                      />
                      <button
                        type="button"
                        className="auth-reveal"
                        aria-label={
                          showPassword
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? (
                          <EyeOff aria-hidden />
                        ) : (
                          <Eye aria-hidden />
                        )}
                      </button>
                    </div>
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
                disabled={pending || (challenge && code.length !== 6)}
              >
                {pending ? (
                  <>
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                    Verificando…
                  </>
                ) : challenge ? (
                  "Verificar"
                ) : (
                  "Continuar"
                )}
              </Button>
            </FieldGroup>
          </form>
          {challenge && (
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
