"use client"
import Link from "next/link"
import { useActionState, useEffect, useState } from "react"
import { LoaderCircle, ShieldCheck, ArrowLeft } from "lucide-react"
import {
  login,
  verify,
  resend,
  changeAccount,
  type AuthState,
} from "@/app/login/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Brand } from "@/components/brand"
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
  return (
    <main className="auth-canvas">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <div className="auth-container">
        <Brand />
        <Card className="auth-card">
          <CardHeader>
            <ShieldCheck className="auth-symbol" />
            <CardTitle>
              <h1>
                {challenge ? "Revisá tu email" : "Panel de administración"}
              </h1>
            </CardTitle>
            <CardDescription>
              {challenge
                ? `Te enviamos un código de 6 dígitos a ${challenge.email}. Vence en 10 minutos.`
                : "Ingresá con tu cuenta de Movo."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
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
                    <FieldLabel htmlFor="code">
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
                      <InputOTPGroup>
                        {Array.from({ length: 6 }, (_, i) => (
                          <InputOTPSlot key={i} index={i} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </Field>
                ) : (
                  <>
                    <Field data-invalid={!!state.error}>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        placeholder="nombre@email.com"
                        required
                        maxLength={254}
                        disabled={pending}
                        aria-invalid={!!state.error}
                      />
                    </Field>
                    <Field data-invalid={!!state.error}>
                      <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={1024}
                        disabled={pending}
                        aria-invalid={!!state.error}
                      />
                      <FieldDescription>
                        Para cambiar tu contraseña, abrí la app de Movo y andá a
                        Perfil → Seguridad.
                      </FieldDescription>
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
                <form action={resendAction}>
                  <Button
                    className="w-full"
                    variant="outline"
                    type="submit"
                    disabled={seconds > 0 || resending || pending}
                  >
                    {resending
                      ? "Enviando…"
                      : seconds > 0
                        ? `Reenviar en ${now ? seconds : "…"} s`
                        : "Reenviar código"}
                  </Button>
                </form>
                <form action={changeAccount}>
                  <Button
                    variant="ghost"
                    type="submit"
                    disabled={pending || resending}
                  >
                    <ArrowLeft data-icon="inline-start" />
                    Usar otra cuenta
                  </Button>
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
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">
              Acceso exclusivo para el equipo de Movo.
            </p>
          </CardFooter>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Movo · Panel de administración
        </p>
      </div>
    </main>
  )
}
