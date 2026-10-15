"use server"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { gateway, publicError } from "@/lib/auth/api"
import {
  assertOrigin,
  clearSession,
  readChallenge,
  requireAdmin,
  writeChallenge,
  writeSession,
  type SessionTokens,
} from "@/lib/auth/session"
import { REFRESH_COOKIE, ACCESS_COOKIE } from "@/lib/auth/policy"
export interface AuthState {
  error?: string
  resendAt?: number
  notice?: string
}

export async function login(
  _previous: AuthState,
  form: FormData
): Promise<AuthState> {
  await assertOrigin()
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase()
  const password = String(form.get("password") ?? "")
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !password ||
    password.length > 1024
  )
    return { error: "Ingresá un email válido y tu contraseña." }
  await clearSession()
  try {
    const result = await gateway<{
      challengeId: string
      cooldownSeconds: number
    }>("/auth/admin/login", { body: { email, password } })
    const [name, domain] = email.split("@")
    await writeChallenge({
      challengeId: result.challengeId,
      email: `${name[0]}***@${domain}`,
      expiresAt: Date.now() + 10 * 60 * 1000,
      resendAt: Date.now() + result.cooldownSeconds * 1000,
    })
  } catch (error) {
    return { error: publicError(error) }
  }
  redirect("/verify")
}
export async function verify(
  _previous: AuthState,
  form: FormData
): Promise<AuthState> {
  await assertOrigin()
  const challenge = await readChallenge()
  if (!challenge) {
    await clearSession()
    redirect("/login")
  }
  const code = String(form.get("code") ?? "")
  if (!/^\d{6}$/.test(code))
    return { error: "Ingresá los 6 dígitos del código." }
  try {
    const session = await gateway<SessionTokens>("/auth/admin/verify", {
      body: { challengeId: challenge.challengeId, code },
    })
    await writeSession(session)
  } catch (error) {
    return { error: publicError(error) }
  }
  redirect("/")
}
export async function resend(_previous: AuthState): Promise<AuthState> {
  void _previous
  await assertOrigin()
  const challenge = await readChallenge()
  if (!challenge) redirect("/login")
  if (challenge.resendAt > Date.now())
    return {
      resendAt: challenge.resendAt,
      error: "Esperá antes de reenviar el código.",
    }
  try {
    const result = await gateway<{ cooldownSeconds: number }>(
      "/auth/resend-otp",
      { body: { otpId: challenge.challengeId } }
    )
    challenge.resendAt = Date.now() + result.cooldownSeconds * 1000
    await writeChallenge(challenge)
    return {
      resendAt: challenge.resendAt,
      notice: "Te enviamos un nuevo código.",
    }
  } catch (error) {
    return { error: publicError(error) }
  }
}
export async function changeAccount(): Promise<void> {
  await assertOrigin()
  await clearSession()
  redirect("/login")
}
export async function logout(_previous: AuthState): Promise<AuthState> {
  void _previous
  await assertOrigin()
  await requireAdmin(true)
  const jar = await cookies()
  try {
    await gateway("/auth/admin/logout", {
      accessToken: jar.get(ACCESS_COOKIE)?.value,
      body: { refreshToken: jar.get(REFRESH_COOKIE)?.value },
    })
  } catch (error) {
    if (!(error instanceof ApiError) || ![401, 403].includes(error.statusCode))
      return { error: publicError(error) }
  }
  await clearSession()
  redirect("/login")
}
