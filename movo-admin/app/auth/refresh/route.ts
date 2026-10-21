import { NextRequest, NextResponse } from "next/server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { clearSession, renew, validateAdmin } from "@/lib/auth/session"
import { internalReturnPath } from "@/lib/auth/policy"
export async function GET(request: NextRequest) {
  const origin = process.env.MOVO_APP_ORIGIN
  if (!origin)
    return new NextResponse("Falta configurar el origen del panel.", {
      status: 503,
    })
  const site = request.headers.get("sec-fetch-site")
  const requestOrigin = request.headers.get("origin")
  if (
    (site && site !== "same-origin" && site !== "none") ||
    (requestOrigin && requestOrigin !== origin)
  ) {
    return new NextResponse(null, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    })
  }
  try {
    const access = await renew()
    await validateAdmin(access)
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    if (![401, 403].includes(error.statusCode)) {
      return NextResponse.redirect(new URL("/login?unavailable=1", origin), {
        headers: { "Cache-Control": "no-store" },
      })
    }
    await clearSession()
    return NextResponse.redirect(new URL("/login?expired=1", origin), {
      headers: { "Cache-Control": "no-store" },
    })
  }
  return NextResponse.redirect(
    new URL(
      internalReturnPath(request.nextUrl.searchParams.get("returnTo")),
      origin
    ),
    { headers: { "Cache-Control": "no-store" } }
  )
}
