import { NextRequest, NextResponse } from "next/server"
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/policy"
export function proxy(request: NextRequest) {
  const response =
    request.cookies.has(ACCESS_COOKIE) || request.cookies.has(REFRESH_COOKIE)
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/login", request.url))
  response.headers.set("Cache-Control", "no-store")
  return response
}
export const config = {
  matcher: [
    "/((?!login(?:/|$)|verify(?:/|$)|forgot(?:/|$)|auth/refresh(?:/|$)|_next/|favicon.ico|brand/|fonts/).*)",
  ],
}
