import { describe, expect, it } from "vitest"
import { basemapStyleUrl, withArcgisToken } from "./tiles"

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
