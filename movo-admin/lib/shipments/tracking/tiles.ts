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

export type BasemapProblem = "missing_key" | "rejected"

/** Estados con los que ArcGIS rechaza la key: inválida, vencida o fuera de los referrers permitidos. */
const REJECTED_STATUSES = new Set([401, 403, 498, 499])

/**
 * `true` si un error de MapLibre significa que ArcGIS rechazó la key. Un corte de red o una tesela
 * suelta no cuentan: el mapa se recupera solo y un aviso ahí sería ruido.
 */
export function isBasemapRejected(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const status = (error as { status?: unknown }).status
  return typeof status === "number" && REJECTED_STATUSES.has(status)
}

export const BASEMAP_NOTICE: Record<BasemapProblem, string> = {
  missing_key: "Mapa sin fondo: falta NEXT_PUBLIC_ESRI_API_KEY en este deploy.",
  rejected:
    "Mapa sin fondo: ArcGIS rechazó la key. Revisá que este dominio esté entre sus referrers.",
}
