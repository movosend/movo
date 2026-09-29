import type { ImageSource } from "expo-image";

/**
 * Clave de caché estable para una imagen remota: la URL sin query string.
 *
 * Las fotos de envío llegan como presigned GET de S3 (`svc-shipments`, TTL de 5 min):
 * cada pedido firma de nuevo y la URL cambia aunque el objeto sea el mismo. Cachear por
 * URL completa haría que cada visita volviera a bajar la foto entera. El path (`bucket` +
 * `key`) sí identifica al objeto, y las keys llevan un UUID propio, así que una foto
 * reemplazada siempre tiene una clave nueva. Las fotos de perfil (ADR-016) ya son URLs
 * públicas estables sin query, y quedan igual.
 */
export function stableImageCacheKey(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

export function remoteImageSource(url: string): ImageSource {
  return { uri: url, cacheKey: stableImageCacheKey(url) };
}
