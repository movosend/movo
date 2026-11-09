import { httpClient } from "./http-client";

/**
 * `POST /geocode/reverse` (MOVO-125) — a diferencia de `placesClient`/`/geocode`
 * (forward), esta ruta está PROTEGIDA. La usan `useMyLocation`
 * (`src/hooks/use-my-location.ts`) y `resolvePinAddress` (`src/lib/pin-address.ts`, al mover
 * el pin en el wizard o en una dirección guardada); todos corren autenticados.
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
