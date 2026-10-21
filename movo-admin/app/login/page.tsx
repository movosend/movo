import type { Metadata } from "next"
import { AuthForm } from "@/components/auth-form"
import { PASSWORD_CHANGED, SESSION_EXPIRED } from "@/lib/auth/policy"
export const metadata: Metadata = { title: "Ingresar" }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    expired?: string
    unavailable?: string
    reset?: string
  }>
}) {
  const params = await searchParams
  return (
    <AuthForm
      retrySession={!!params.unavailable}
      notice={
        params.reset
          ? PASSWORD_CHANGED
          : params.expired
            ? SESSION_EXPIRED
            : params.unavailable
              ? "Movo no está disponible. Tu sesión se conservó; volvé a intentar desde Inicio."
              : undefined
      }
    />
  )
}
