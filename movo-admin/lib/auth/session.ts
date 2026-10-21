import "server-only"
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { gateway } from "./api"
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CHALLENGE_COOKIE,
  RESET_COOKIE,
  GRANT_COOKIE,
} from "./policy"

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  sessionExpiresAt: string
}
export interface AdminProfile {
  id: string
  fullName: string
  email: string
  photoUrl?: string | null
  roles: string[]
  accountStatus: string
  emailVerified: boolean
}
export interface Challenge {
  challengeId: string
  email: string
  expiresAt: number
  resendAt: number
}
/** Recuperación de contraseña: primero el otpId, después (verificado el código) el token. */
export interface ResetFlow {
  otpId: string
  target: string
  channel: "sms" | "email"
  expiresAt: number
  resendAt: number
  passwordResetToken?: string
}
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
}
function secret(): string {
  const value = process.env.MOVO_SESSION_SECRET
  if (!value || value.length < 32)
    throw new Error("MOVO_SESSION_SECRET must contain at least 32 characters")
  return value
}
function key(): Buffer {
  return createHash("sha256").update(secret()).digest()
}
export function seal(value: unknown): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(value)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64url")
}
export function unseal<T>(value: string): T | null {
  try {
    const bytes = Buffer.from(value, "base64url")
    const cipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12))
    cipher.setAuthTag(bytes.subarray(-16))
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(12, -16)),
        cipher.final(),
      ]).toString()
    ) as T
  } catch {
    return null
  }
}
export async function assertOrigin(): Promise<void> {
  const h = await headers()
  const origin = h.get("origin")
  const allowed = process.env.MOVO_APP_ORIGIN
  if (!allowed || origin !== new URL(allowed).origin)
    throw new ApiError(403, "AUTH_TOKEN_INVALID", "Origen inválido.")
}
export async function writeSession(session: SessionTokens): Promise<void> {
  const jar = await cookies()
  const remaining = Math.min(
    8 * 3600,
    Math.floor((Date.parse(session.sessionExpiresAt) - Date.now()) / 1000)
  )
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new ApiError(401, "AUTH_REFRESH_INVALID", "Sesión vencida.")
  jar.set(ACCESS_COOKIE, session.accessToken, {
    ...cookieOptions,
    maxAge: Math.min(session.expiresIn, remaining),
  })
  jar.set(REFRESH_COOKIE, session.refreshToken, {
    ...cookieOptions,
    maxAge: remaining,
  })
  jar.set(CHALLENGE_COOKIE, "", { ...cookieOptions, maxAge: 0 })
}
export async function clearSession(): Promise<void> {
  const jar = await cookies()
  for (const name of [
    ACCESS_COOKIE,
    REFRESH_COOKIE,
    CHALLENGE_COOKIE,
    GRANT_COOKIE,
  ])
    jar.set(name, "", { ...cookieOptions, maxAge: 0 })
}
export async function writeChallenge(challenge: Challenge): Promise<void> {
  ;(await cookies()).set(CHALLENGE_COOKIE, seal(challenge), {
    ...cookieOptions,
    maxAge: Math.max(0, Math.floor((challenge.expiresAt - Date.now()) / 1000)),
  })
}
export async function readChallenge(): Promise<Challenge | null> {
  const value = (await cookies()).get(CHALLENGE_COOKIE)?.value
  const challenge = value ? unseal<Challenge>(value) : null
  return challenge && challenge.expiresAt > Date.now() ? challenge : null
}
export async function renew(): Promise<string> {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value
  if (!refreshToken)
    throw new ApiError(401, "AUTH_REFRESH_INVALID", "Sesión vencida.")
  const idempotencyKey = createHmac("sha256", secret())
    .update(`panel-refresh:${refreshToken}`)
    .digest("base64url")
  const session = await gateway<SessionTokens>("/auth/admin/refresh", {
    body: { refreshToken },
    idempotencyKey,
  })
  await writeSession(session)
  return session.accessToken
}
// Call beside each protected operation. Gateway validates signature, expiry, panel
// revocation and roles; profile supplies current eligibility, never cookie presence.
export async function validateAdmin(access: string): Promise<AdminProfile> {
  const [profile] = await Promise.all([
    gateway<AdminProfile>("/users/me", { accessToken: access }),
    gateway("/admin/session", { accessToken: access }),
  ])
  if (
    !profile.roles.includes("admin") ||
    profile.accountStatus !== "active" ||
    !profile.emailVerified
  )
    throw new ApiError(401, "AUTH_TOKEN_INVALID", "Sesión inválida.")
  return profile
}
export async function requireAdmin(
  mutable = false,
  returnTo = "/"
): Promise<AdminProfile> {
  let access = (await cookies()).get(ACCESS_COOKIE)?.value
  try {
    if (!access)
      throw new ApiError(401, "AUTH_TOKEN_INVALID", "Sesión vencida.")
    return await validateAdmin(access)
  } catch (error) {
    if (!(error instanceof ApiError) || ![401, 403].includes(error.statusCode))
      throw error
    if (!mutable)
      redirect(`/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`)
    try {
      access = await renew()
      return await validateAdmin(access)
    } catch (retryError) {
      if (
        !(retryError instanceof ApiError) ||
        ![401, 403].includes(retryError.statusCode)
      )
        throw retryError
      await clearSession()
      redirect("/login?expired=1")
    }
  }
}
export async function writeReset(flow: ResetFlow): Promise<void> {
  ;(await cookies()).set(RESET_COOKIE, seal(flow), {
    ...cookieOptions,
    maxAge: Math.max(0, Math.floor((flow.expiresAt - Date.now()) / 1000)),
  })
}
export async function readReset(): Promise<ResetFlow | null> {
  const value = (await cookies()).get(RESET_COOKIE)?.value
  const flow = value ? unseal<ResetFlow>(value) : null
  return flow && flow.expiresAt > Date.now() ? flow : null
}
export async function clearReset(): Promise<void> {
  ;(await cookies()).set(RESET_COOKIE, "", { ...cookieOptions, maxAge: 0 })
}
/**
 * Doble verificación para otorgar el rol admin: el desafío (contraseña ya validada, código
 * enviado al email del admin) y a quién se le va a dar el rol. El destino sale de acá, nunca del
 * formulario del segundo paso, y queda atado al admin que lo pidió.
 */
export interface GrantFlow {
  adminId: string
  challengeId: string
  targetEmail: string
  targetName: string
  maskedEmail: string
  expiresAt: number
  resendAt: number
}
export async function writeGrant(flow: GrantFlow): Promise<void> {
  ;(await cookies()).set(GRANT_COOKIE, seal(flow), {
    ...cookieOptions,
    maxAge: Math.max(0, Math.floor((flow.expiresAt - Date.now()) / 1000)),
  })
}
export async function readGrant(): Promise<GrantFlow | null> {
  const value = (await cookies()).get(GRANT_COOKIE)?.value
  const flow = value ? unseal<GrantFlow>(value) : null
  return flow && flow.expiresAt > Date.now() ? flow : null
}
export async function clearGrant(): Promise<void> {
  ;(await cookies()).set(GRANT_COOKIE, "", { ...cookieOptions, maxAge: 0 })
}
