import { AuthForm } from "@/components/auth-form"
import { SESSION_EXPIRED } from "@/lib/auth/policy"
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; unavailable?: string }>
}) {
  const params = await searchParams
  return (
    <AuthForm
      retrySession={!!params.unavailable}
      notice={
        params.expired
          ? SESSION_EXPIRED
          : params.unavailable
            ? "Movo no está disponible. Tu sesión se conservó; volvé a intentar desde Inicio."
            : undefined
      }
    />
  )
}
