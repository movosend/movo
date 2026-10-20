"use server"
import { redirect } from "next/navigation"
import { gateway, publicError } from "@/lib/auth/api"
import {
  assertOrigin,
  clearReset,
  readReset,
  writeReset,
} from "@/lib/auth/session"
import { maskIdentifier, parseIdentifier } from "@/lib/auth/identifier"
import type { AuthState } from "@/app/login/actions"

// La recuperación reutiliza los endpoints públicos de la app (/auth/forgot-password,
// /verify-reset-otp, /reset-password). El otpId y el token viven en una cookie sellada,
// nunca en el cliente.
const FLOW_TTL_MS = 15 * 60 * 1000
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/

export async function requestReset(
  _previous: AuthState,
  form: FormData
): Promise<AuthState> {
  await assertOrigin()
  const identifier = parseIdentifier(
    String(form.get("method") ?? "email"),
    String(form.get("identifier") ?? "").trim()
  )
  if (!identifier) return { error: "Ingresá un email o teléfono válido." }
  try {
    const result = await gateway<{
      otpId: string
      cooldownSeconds: number
      channel: "sms" | "email"
    }>("/auth/forgot-password", {
      body: {
        identifier: "phone" in identifier ? identifier.phone : identifier.email,
        // Desde el panel solo se recuperan cuentas admin; con otra, el código no sale.
        panelOnly: true,
      },
    })
    await writeReset({
      otpId: result.otpId,
      target: maskIdentifier(identifier),
      channel: result.channel,
      expiresAt: Date.now() + 10 * 60 * 1000,
      resendAt: Date.now() + result.cooldownSeconds * 1000,
    })
  } catch (error) {
    return { error: publicError(error) }
  }
  redirect("/forgot/code")
}

export async function verifyResetCode(
  _previous: AuthState,
  form: FormData
): Promise<AuthState> {
  await assertOrigin()
  const flow = await readReset()
  if (!flow) redirect("/forgot")
  const code = String(form.get("code") ?? "")
  if (!/^\d{6}$/.test(code))
    return { error: "Ingresá los 6 dígitos del código." }
  try {
    const result = await gateway<{ passwordResetToken: string }>(
      "/auth/verify-reset-otp",
      { body: { otpId: flow.otpId, code } }
    )
    await writeReset({
      ...flow,
      passwordResetToken: result.passwordResetToken,
      expiresAt: Date.now() + FLOW_TTL_MS,
    })
  } catch (error) {
    return { error: publicError(error) }
  }
  redirect("/forgot/new")
}

export async function resendResetCode(
  _previous: AuthState
): Promise<AuthState> {
  void _previous
  await assertOrigin()
  const flow = await readReset()
  if (!flow) redirect("/forgot")
  if (flow.resendAt > Date.now())
    return {
      resendAt: flow.resendAt,
      error: "Esperá antes de reenviar el código.",
    }
  try {
    const result = await gateway<{ cooldownSeconds: number }>(
      "/auth/resend-otp",
      { body: { otpId: flow.otpId } }
    )
    flow.resendAt = Date.now() + result.cooldownSeconds * 1000
    await writeReset(flow)
    return { resendAt: flow.resendAt, notice: "Te enviamos un nuevo código." }
  } catch (error) {
    return { error: publicError(error) }
  }
}

export async function setNewPassword(
  _previous: AuthState,
  form: FormData
): Promise<AuthState> {
  await assertOrigin()
  const flow = await readReset()
  if (!flow?.passwordResetToken) redirect("/forgot")
  const password = String(form.get("password") ?? "")
  if (!PASSWORD_POLICY.test(password))
    return { error: "Usá al menos 8 caracteres, con letras y números." }
  if (password !== String(form.get("confirm") ?? ""))
    return { error: "Las contraseñas no coinciden." }
  try {
    await gateway("/auth/reset-password", {
      body: {
        passwordResetToken: flow.passwordResetToken,
        newPassword: password,
      },
    })
  } catch (error) {
    return { error: publicError(error) }
  }
  await clearReset()
  redirect("/login?reset=1")
}

export async function cancelReset(): Promise<void> {
  await assertOrigin()
  await clearReset()
  redirect("/login")
}
