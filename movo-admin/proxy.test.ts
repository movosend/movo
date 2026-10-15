import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "./proxy"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
describe("filtro de rutas", () => {
  it("sin cookies redirige a login y no permite caché", () => {
    const response = proxy(new NextRequest("https://admin.test/"))
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://admin.test/login")
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it("presencia de cookies solo permite llegar a la DAL", () => {
    const response = proxy(
      new NextRequest("https://admin.test/", {
        headers: { cookie: `${ACCESS_COOKIE}=invalid` },
      })
    )
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })
})
