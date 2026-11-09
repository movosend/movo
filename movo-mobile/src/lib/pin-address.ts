import { geocodeClient } from "../api/geocode-client";

/** Texto de una dirección marcada a mano en el mapa cuando el reverse-geocode no la resuelve. */
export const PIN_ADDRESS_FALLBACK = "Ubicación en el mapa";

/**
 * Dirección del punto donde quedó el pin después de moverlo. El texto anterior ya no corresponde a las coordenadas
 * nuevas (feedback de TestFlight, build 17: la entrega seguía diciendo "Ubicación actual" con el pin en otra calle),
 * así que si Google no la resuelve se usa el texto genérico, nunca el viejo.
 */
export async function resolvePinAddress(
  lat: number,
  lng: number,
): Promise<string> {
  try {
    const { formattedAddress } = await geocodeClient.reverseGeocode(lat, lng);
    return formattedAddress.trim() || PIN_ADDRESS_FALLBACK;
  } catch {
    return PIN_ADDRESS_FALLBACK;
  }
}
