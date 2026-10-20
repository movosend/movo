"use server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { gateway, publicError } from "@/lib/auth/api"
import type { AdminCandidate } from "@movo/shared/src/types/user"
import {
  assertOrigin,
  clearGrant,
  readGrant,
  requireAdmin,
  writeGrant,
  type AdminProfile,
  type SessionTokens,
} from "@/lib/auth/session"
import { ACCESS_COOKIE } from "@/lib/auth/policy"

export interface AdminsState {
  error?: string
  notice?: string
}

// Con el gateway o un servicio caído `requireAdmin` lanza un ApiError 5xx: se devuelve como estado
// del formulario en vez de subir al error boundary. Un 401/403 redirige (NEXT_REDIRECT, que no es un
// ApiError) y se deja pasar.
async function authorize(): Promise<AdminProfile | { error: string }> {
  try {
    return await requireAdmin(true)
  } catch (error) {
    if (error instanceof ApiError) return { error: publicError(error) }
    throw error
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Autocompletado del alta: nombre o email. Devuelve [] ante cualquier falla, el campo no es crítico. */
export async function searchCandidates(
  query: string
): Promise<AdminCandidate[]> {
  await assertOrigin()
  const term = String(query ?? "").trim()
  if (term.length < 2 || term.length > 100) return []
  const auth = await authorize()
  if ("error" in auth) return []
  try {
    return await gateway<AdminCandidate[]>(
      `/admin/admins/candidates?q=${encodeURIComponent(term)}`,
      { accessToken: (await cookies()).get(ACCESS_COOKIE)?.value }
    )
  } catch {
    return []
  }
}

/** Estado de la doble verificación para otorgar el rol (ver `GrantFlow` en `lib/auth/session`). */
export interface GrantState {
  error?: string
  /** Se pasó al paso del código: email enmascarado al que se envió y cuándo se puede reenviar. */
  codeSentTo?: string
  resendAt?: number
  /** El código ya se consumió o venció: hay que volver a empezar desde la búsqueda. */
  restart?: boolean
  /** Rol otorgado. */
  done?: string
}

const GRANT_TTL_MS = 10 * 60 * 1000

/**
 * Paso 1: el admin que otorga vuelve a probar quién es con su contraseña. Se reusa el login del
 * panel (`/auth/admin/login`), que valida la contraseña y manda un código al email de su cuenta;
 * el desafío queda sellado en una cookie junto con el destino del rol.
 */
export async function startGrant(
  _previous: GrantState,
  form: FormData
): Promise<GrantState> {
  void _previous
  await assertOrigin()
  const profile = await authorize()
  if ("error" in profile) return profile
  const targetEmail = String(form.get("targetEmail") ?? "")
    .trim()
    .toLowerCase()
  const targetName = String(form.get("targetName") ?? "")
    .trim()
    .slice(0, 120)
  const password = String(form.get("password") ?? "")
  if (!EMAIL.test(targetEmail) || targetEmail.length > 254)
    return { error: "Elegí a la persona de la lista.", restart: true }
  if (!password || password.length > 1024)
    return { error: "Ingresá tu contraseña." }
  try {
    const result = await gateway<{
      challengeId: string
      cooldownSeconds: number
      maskedEmail: string
    }>("/auth/admin/login", { body: { email: profile.email, password } })
    const resendAt = Date.now() + result.cooldownSeconds * 1000
    await writeGrant({
      adminId: profile.id,
      challengeId: result.challengeId,
      targetEmail,
      targetName,
      maskedEmail: result.maskedEmail,
      expiresAt: Date.now() + GRANT_TTL_MS,
      resendAt,
    })
    return { codeSentTo: result.maskedEmail, resendAt }
  } catch (error) {
    // Acá el backend responde igual a "contraseña incorrecta" que a cuenta sin acceso al panel.
    if (error instanceof ApiError && error.code === "AUTH_INVALID_CREDENTIALS")
      return { error: "La contraseña no es correcta." }
    return { error: publicError(error) }
  }
}

/**
 * Paso 2: con el código correcto se otorga el rol. El destino sale de la cookie sellada del paso 1.
 * El login del panel emite una sesión nueva al verificar: se cierra enseguida, esto es solo una
 * prueba de identidad y no debe dejar un refresh token vivo.
 */
export async function confirmGrant(
  _previous: GrantState,
  form: FormData
): Promise<GrantState> {
  void _previous
  await assertOrigin()
  const profile = await authorize()
  if ("error" in profile) return profile
  const flow = await readGrant()
  if (!flow || flow.adminId !== profile.id)
    return {
      error: "La verificación venció. Empezá de nuevo.",
      restart: true,
    }
  const code = String(form.get("code") ?? "")
  if (!/^\d{6}$/.test(code))
    return { error: "Ingresá los 6 dígitos del código." }
  try {
    const proof = await gateway<SessionTokens>("/auth/admin/verify", {
      body: { challengeId: flow.challengeId, code },
    })
    await gateway("/auth/admin/logout", {
      accessToken: proof.accessToken,
      body: { refreshToken: proof.refreshToken },
    }).catch(() => undefined)
  } catch (error) {
    if (error instanceof ApiError && error.code === "AUTH_OTP_EXPIRED") {
      await clearGrant()
      return { error: publicError(error), restart: true }
    }
    return { error: publicError(error) }
  }
  await clearGrant()
  try {
    await gateway("/admin/admins", {
      accessToken: (await cookies()).get(ACCESS_COOKIE)?.value,
      body: { email: flow.targetEmail },
    })
  } catch (error) {
    return { error: publicError(error), restart: true }
  }
  revalidatePath("/admins")
  return { done: flow.targetName || flow.targetEmail }
}

export async function resendGrantCode(
  _previous: GrantState
): Promise<GrantState> {
  void _previous
  await assertOrigin()
  const profile = await authorize()
  if ("error" in profile) return profile
  const flow = await readGrant()
  if (!flow || flow.adminId !== profile.id)
    return { error: "La verificación venció. Empezá de nuevo.", restart: true }
  if (flow.resendAt > Date.now())
    return {
      error: "Esperá antes de reenviar el código.",
      resendAt: flow.resendAt,
    }
  try {
    const result = await gateway<{ cooldownSeconds: number }>(
      "/auth/resend-otp",
      { body: { otpId: flow.challengeId } }
    )
    flow.resendAt = Date.now() + result.cooldownSeconds * 1000
    await writeGrant(flow)
    return { codeSentTo: flow.maskedEmail, resendAt: flow.resendAt }
  } catch (error) {
    return { error: publicError(error) }
  }
}

export async function cancelGrant(): Promise<void> {
  await assertOrigin()
  await clearGrant()
}

export async function revokeAdmin(
  _previous: AdminsState,
  form: FormData
): Promise<AdminsState> {
  void _previous
  await assertOrigin()
  const profile = await authorize()
  if ("error" in profile) return profile
  const userId = String(form.get("userId") ?? "")
  const reason = String(form.get("reason") ?? "").trim()
  if (!UUID.test(userId)) return { error: "No pudimos identificar al admin." }
  // El backend lo rechaza igual (ADMIN_CONFLICT_OF_INTEREST); acá se corta antes.
  if (userId === profile.id)
    return { error: "No podés revocarte el rol a vos mismo." }
  if (reason.length < 3 || reason.length > 500)
    return { error: "Escribí el motivo (entre 3 y 500 caracteres)." }
  try {
    await gateway(`/admin/admins/${userId}`, {
      method: "DELETE",
      accessToken: (await cookies()).get(ACCESS_COOKIE)?.value,
      body: { reason },
    })
  } catch (error) {
    return { error: publicError(error) }
  }
  // Sin aviso: la fila desaparece de la lista y con ella este formulario.
  revalidatePath("/admins")
  return {}
}
