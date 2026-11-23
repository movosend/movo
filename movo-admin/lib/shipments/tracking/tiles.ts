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

export type BasemapProblem =
  | { kind: "missing_key" }
  | { kind: "invalid_key" }
  | { kind: "referrer" }
  | { kind: "error"; status: number }

/**
 * Key inválida, vencida o ausente en el request. ArcGIS responde HTTP 401 con `code: 498` en el
 * cuerpo, y MapLibre solo expone el estado HTTP; 498 y 499 cubren el caso de que llegue como estado.
 */
const INVALID_KEY_STATUSES = new Set([401, 498, 499])

/**
 * Qué problema del mapa base indica un error de MapLibre, o `null` si no amerita aviso. Una key
 * rechazada se informa venga del request que venga; otro error HTTP, solo si falló el estilo (sin él no
 * hay fondo). Un corte de red o una tesela suelta no cuentan: el mapa se recupera solo.
 */
export function basemapProblemFrom(error: unknown): BasemapProblem | null {
  if (typeof error !== "object" || error === null) return null
  const { status, url } = error as { status?: unknown; url?: unknown }
  if (typeof status !== "number") return null
  if (INVALID_KEY_STATUSES.has(status)) return { kind: "invalid_key" }
  if (status === 403) return { kind: "referrer" }
  if (status >= 400 && typeof url === "string" && isStyleRequest(url)) {
    return { kind: "error", status }
  }
  return null
}

function isStyleRequest(url: string): boolean {
  try {
    return new URL(url).hostname === STYLE_HOST
  } catch {
    return false
  }
}

export function basemapNotice(problem: BasemapProblem): string {
  switch (problem.kind) {
    case "missing_key":
      return "Mapa sin fondo: falta NEXT_PUBLIC_ESRI_API_KEY en este deploy."
    case "invalid_key":
      return "Mapa sin fondo: la key de ArcGIS es inválida o venció."
    case "referrer":
      return "Mapa sin fondo: ArcGIS rechazó la key. Revisá que este dominio esté entre sus referrers."
    case "error":
      return `Mapa sin fondo: ArcGIS respondió con error ${problem.status}.`
  }
}
