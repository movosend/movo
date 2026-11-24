import { existsSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { mockGetKycEvidence, mockListKycReviews } from "./mock"

vi.mock("server-only", () => ({}))

/** La demo no puede mostrar una imagen rota: cada imagen es un dibujo de respaldo o un archivo que existe en `public/`. */
describe("imágenes de la evidencia de KYC en el modo fixtures", () => {
  beforeAll(() => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
  })

  it("cada imagen es real (si está en public/demo/kyc) o de respaldo; solo el caso sin datos de Didit trae menos", async () => {
    const { items } = await mockListKycReviews({ q: "", page: 1 })
    expect(items.length).toBeGreaterThanOrEqual(6)
    for (const item of items) {
      const { images } = await mockGetKycEvidence(item.sessionId)
      // El caso sin motivo simula que Didit no informó nada: solo conserva la selfie (estado vacío de los otros bloques).
      const noData = item.reason === null
      expect(images.selfie).toBeTruthy()
      for (const url of [images.selfie, images.documentPortrait, images.documentFront, images.documentBack]) {
        if (url === null) {
          expect(noData).toBe(true)
          continue
        }
        if (url.startsWith("/demo/kyc/")) expect(existsSync(join(process.cwd(), "public", url))).toBe(true)
        else expect(url).toMatch(/^data:image\/svg\+xml/)
      }
    }
  })
})
