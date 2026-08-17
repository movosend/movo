import { httpClient } from "./http-client";

/**
 * `POST /geocode/reverse` (MOVO-125) — a diferencia de `placesClient`/`/geocode`
 * (forward), esta ruta está PROTEGIDA: su único caller es `useShipmentAddress` en el
 * wizard de envíos, que ya corre autenticado. `httpClient` adjunta el `Authorization`
 * automáticamente, igual que el resto de los clientes protegidos.
 */
export interface ReverseGeocodeResult {
  formattedAddress: string;
}

export const geocodeClient = {
  reverseGeocode(lat: number, long: number): Promise<ReverseGeocodeResult> {
    return httpClient.post<ReverseGeocodeResult>("/geocode/reverse", { lat, long });
  },
};
