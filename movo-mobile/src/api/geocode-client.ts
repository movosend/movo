import { httpClient } from "./http-client";

/**
 * `POST /geocode/reverse` (MOVO-125) — a diferencia de `placesClient`/`/geocode`
 * (forward), esta ruta está PROTEGIDA: su único caller es `useMyLocation`
 * (`src/hooks/use-my-location.ts`, extraído del wizard de envíos en MOVO-121), que ya
 * corre autenticado en todos sus usos (wizard y pantalla de direcciones guardadas).
 * `httpClient` adjunta el `Authorization` automáticamente, igual que el resto de los
 * clientes protegidos.
 */
export interface ReverseGeocodeResult {
  formattedAddress: string;
}

export const geocodeClient = {
  reverseGeocode(lat: number, long: number): Promise<ReverseGeocodeResult> {
    return httpClient.post<ReverseGeocodeResult>("/geocode/reverse", { lat, long });
  },
};
