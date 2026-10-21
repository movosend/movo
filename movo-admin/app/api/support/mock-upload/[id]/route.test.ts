import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"
import { SUPPORT_ATTACHMENT_MAX_BYTES } from "@movo/shared/src/types/admin-support"

const storeUpload = vi.hoisted(() => vi.fn(() => true))
vi.mock("@/lib/support/mock", () => ({
  mockEnabled: () => true,
  mockStoreUpload: storeUpload,
}))
vi.mock("@/lib/support/session-api", () => ({
  adminForApi: async () => ({ id: "admin" }),
}))

import { PUT } from "./route"

beforeEach(() => storeUpload.mockClear())

describe("PUT mock upload", () => {
  const params = { params: Promise.resolve({ id: "attachment" }) }

  it("rechaza Content-Length excesivo antes de leer el body", async () => {
    const request = {
      headers: new Headers({
        "content-length": String(SUPPORT_ATTACHMENT_MAX_BYTES + 1),
      }),
      get body() {
        throw new Error("body leído")
      },
    } as unknown as NextRequest
    expect((await PUT(request, params)).status).toBe(413)
    expect(storeUpload).not.toHaveBeenCalled()
  })

  it("limita también un body sin Content-Length", async () => {
    const request = {
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(SUPPORT_ATTACHMENT_MAX_BYTES + 1))
        },
      }),
    } as unknown as NextRequest
    expect((await PUT(request, params)).status).toBe(413)
    expect(storeUpload).not.toHaveBeenCalled()
  })
})
