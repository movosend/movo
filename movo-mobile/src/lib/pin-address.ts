import { geocodeClient } from "../api/geocode-client";

/** Texto de una dirección marcada a mano en el mapa cuando el reverse-geocode no la resuelve. */
export const PIN_ADDRESS_FALLBACK = "Ubicación en el mapa";

/** Tope para esperar a Google: `httpClient` no tiene timeout propio y, mientras resuelve, el guardado queda bloqueado. */
export const PIN_ADDRESS_TIMEOUT_MS = 8000;

/**
 * Dirección del punto donde quedó el pin después de moverlo. El texto anterior ya no corresponde a las coordenadas
 * nuevas (feedback de TestFlight, build 17: la entrega seguía diciendo "Ubicación actual" con el pin en otra calle),
 * así que si Google no la resuelve (o tarda más de `PIN_ADDRESS_TIMEOUT_MS`) se usa el texto genérico, nunca el viejo.
 * Nunca lanza.
 */
export async function resolvePinAddress(
  lat: number,
  lng: number,
  timeoutMs: number = PIN_ADDRESS_TIMEOUT_MS,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(PIN_ADDRESS_FALLBACK), timeoutMs);
  });
  const lookup = geocodeClient
    .reverseGeocode(lat, lng)
    .then(({ formattedAddress }) => formattedAddress.trim() || PIN_ADDRESS_FALLBACK)
    .catch(() => PIN_ADDRESS_FALLBACK);
  try {
    return await Promise.race([lookup, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
