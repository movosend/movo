import { describe, expect, it } from "vitest"
import {
  basemapNotice,
  basemapProblemFrom,
  basemapStyleUrl,
  withArcgisToken,
} from "./tiles"

describe("basemapStyleUrl", () => {
  it("sin key no hay estilo", () => {
    expect(basemapStyleUrl("light", undefined)).toBeNull()
    expect(basemapStyleUrl("dark", "")).toBeNull()
  })

  it("elige gris claro u oscuro según el tema, sin la key en la URL", () => {
    expect(basemapStyleUrl("light", "k")).toContain("/arcgis/light-gray?")
    expect(basemapStyleUrl("dark", "k")).toContain("/arcgis/dark-gray?")
    expect(basemapStyleUrl("light", "k")).not.toContain("token")
  })
})

describe("withArcgisToken", () => {
  const transform = withArcgisToken("a b")

  it("suma la key a los requests de ArcGIS, con o sin query", () => {
    expect(
      transform("https://basemaps-api.arcgis.com/x/tile/1/2/3.pbf").url
    ).toBe("https://basemaps-api.arcgis.com/x/tile/1/2/3.pbf?token=a%20b")
    expect(
      transform("https://basemapstyles-api.arcgis.com/s?type=style").url
    ).toBe("https://basemapstyles-api.arcgis.com/s?type=style&token=a%20b")
  })

  it("no toca otros hosts ni repite el token", () => {
    expect(transform("https://example.com/a").url).toBe("https://example.com/a")
    const withToken = "https://basemaps-api.arcgis.com/a?token=z"
    expect(transform(withToken).url).toBe(withToken)
  })
})

describe("basemapProblemFrom", () => {
  const style =
    "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/dark-gray?type=style&token=k"
  const tile = "https://basemaps-api.arcgis.com/x/tile/1/2/3.pbf?token=k"

  it("401, 498 y 499: la key es inválida o venció", () => {
    for (const status of [401, 498, 499]) {
      expect(basemapProblemFrom({ status, url: tile })).toEqual({
        kind: "invalid_key",
      })
    }
  })

  it("403: el dominio no está entre los referrers", () => {
    expect(basemapProblemFrom({ status: 403 })).toEqual({ kind: "referrer" })
  })

  it("otro error del estilo: genérico con el código", () => {
    expect(basemapProblemFrom({ status: 500, url: style })).toEqual({
      kind: "error",
      status: 500,
    })
  })

  it("no avisa por una tesela suelta ni por errores sin estado", () => {
    expect(basemapProblemFrom({ status: 500, url: tile })).toBeNull()
    expect(basemapProblemFrom({ status: 404 })).toBeNull()
    expect(basemapProblemFrom(new Error("red"))).toBeNull()
    expect(basemapProblemFrom(undefined)).toBeNull()
  })
})

describe("basemapNotice", () => {
  it("un texto por caso, con el código en el genérico", () => {
    expect(basemapNotice({ kind: "invalid_key" })).toContain(
      "inválida o venció"
    )
    expect(basemapNotice({ kind: "referrer" })).toContain("referrers")
    expect(basemapNotice({ kind: "error", status: 502 })).toContain("502")
  })
})
