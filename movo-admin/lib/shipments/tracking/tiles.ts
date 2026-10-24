export type MapTheme = "light" | "dark"

export const TILE_ATTRIBUTION = "© Esri"

/**
 * Teselas raster de ArcGIS Location Platform (gris claro / gris oscuro, como el prototipo) con API
 * key restringida por referrer (`NEXT_PUBLIC_ESRI_API_KEY`). Sin key devuelve `null` y el mapa se
 * dibuja igual sobre el fondo liso del tema, con la ruta y los marcadores.
 */
export function tileUrl(
  theme: MapTheme,
  apiKey: string | undefined
): string | null {
  if (!apiKey) return null
  const layer =
    theme === "dark" ? "World_Dark_Gray_Base" : "World_Light_Gray_Base"
  return `https://ibasemaps-api.arcgis.com/arcgis/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}?token=${encodeURIComponent(apiKey)}`
}
