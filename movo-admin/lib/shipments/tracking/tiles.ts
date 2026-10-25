export type MapTheme = "light" | "dark"

export const TILE_ATTRIBUTION = "© Esri"

const STYLE_HOST = "basemapstyles-api.arcgis.com"

/**
 * Estilo vectorial del Basemap Styles Service de ArcGIS Location Platform (gris claro / gris oscuro,
 * como el prototipo), con API key restringida por referrer (`NEXT_PUBLIC_ESRI_API_KEY`). Sin key
 * devuelve `null` y el mapa se dibuja igual sobre el fondo liso del tema, con la ruta y los marcadores.
 */
export function basemapStyleUrl(
  theme: MapTheme,
  apiKey: string | undefined
): string | null {
  if (!apiKey) return null
  const style = theme === "dark" ? "dark-gray" : "light-gray"
  return `https://${STYLE_HOST}/arcgis/rest/services/styles/v2/styles/arcgis/${style}?type=style`
}

/**
 * El estilo no trae la key en las URLs de teselas, glifos y sprites que referencia: se la suma a cada
 * request que va a ArcGIS. Es el `transformRequest` de MapLibre.
 */
export function withArcgisToken(apiKey: string) {
  return (url: string): { url: string } => {
    let host: string
    try {
      host = new URL(url).hostname
    } catch {
      return { url }
    }
    if (!host.endsWith(".arcgis.com") || url.includes("token=")) return { url }
    const sep = url.includes("?") ? "&" : "?"
    return { url: `${url}${sep}token=${encodeURIComponent(apiKey)}` }
  }
}
