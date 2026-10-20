import "server-only"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import {
  clearSession,
  renew,
  validateAdmin,
  type AdminProfile,
} from "@/lib/auth/session"
import type { MockActor } from "./mock"

export const noStore = { "Cache-Control": "no-store" }

/**
 * Sesión de admin para un Route Handler (`fetch` desde el navegador): a diferencia de
 * `requireAdmin`, no redirige; devuelve la respuesta de error. Renueva una sola vez ante un 401.
 * Pide mismo origen (`Sec-Fetch-Site`/`Origin`): son lecturas con cookies Lax.
 */
export async function adminForApi(
  request: NextRequest
): Promise<{ admin: AdminProfile; actor: MockActor } | NextResponse> {
  const allowed = process.env.MOVO_APP_ORIGIN
  const site = request.headers.get("sec-fetch-site")
  const origin = request.headers.get("origin")
  if (
    !allowed ||
    (site && site !== "same-origin") ||
    (origin && origin !== new URL(allowed).origin)
  )
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore })
  try {
    let access = (await cookies()).get(ACCESS_COOKIE)?.value
    try {
      if (!access) throw new ApiError(401, "AUTH_TOKEN_INVALID", "Sesión vencida.")
      const admin = await validateAdmin(access)
      return { admin, actor: { adminId: admin.id, adminName: admin.fullName } }
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.statusCode))
        throw error
      access = await renew()
      const admin = await validateAdmin(access)
      return { admin, actor: { adminId: admin.id, adminName: admin.fullName } }
    }
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.statusCode)) {
      await clearSession()
      return NextResponse.json({ error: "session" }, { status: 401, headers: noStore })
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore })
  }
}
