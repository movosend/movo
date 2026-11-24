import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MOCK_DISPUTES } from "./fixtures"

/** La demo no puede mostrar una foto rota: cada URL de las fixtures tiene que ser un archivo que existe en `public/`. */
describe("fotos de las fixtures de disputas", () => {
  const urls = MOCK_DISPUTES.flatMap((d) => [
    ...d.photos.map((p) => p.url), // fotos del envío (retiro y entrega)
    ...d.detail.photos.map((p) => p.url), // fotos de la apertura
    ...d.detail.statements.flatMap((s) => s.photos.map((p) => p.url)), // descargos
  ])

  it("hay fotos para mostrar", () => {
    expect(urls.length).toBeGreaterThan(0)
  })

  it("todas son fotos reales de public/demo/disputes que existen", () => {
    for (const url of urls) {
      expect(url).toMatch(/^\/demo\/disputes\/pkg-\d+\.jpg$/)
      expect(existsSync(join(process.cwd(), "public", url))).toBe(true)
    }
  })
})
