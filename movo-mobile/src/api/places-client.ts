import { httpClient } from "./http-client";

/**
 * Contrato acordado con el proxy nuevo de `movo-svc-users` (paralelo a MOVO-83,
 * mismo criterio que `/geocode`: público, sin auth, la API key de Google Places
 * queda server-side). Reemplaza el formulario manual de dirección del wizard de
 * envíos por búsqueda tipo Uber/PedidosYa — el usuario escribe texto libre y elige
 * de una lista de direcciones completas, en vez de cargar calle/número/ciudad/CP a
 * mano por separado.
 */
export interface PlacePrediction {
  placeId: string;
  description: string;
}

export interface PlaceDetails {
  formattedAddress: string;
  lat: number;
  long: number;
}

export const placesClient = {
  autocomplete(input: string): Promise<PlacePrediction[]> {
    return httpClient
      .post<{ predictions: PlacePrediction[] }>("/places/autocomplete", { input })
      .then((res) => res.predictions);
  },

  details(placeId: string): Promise<PlaceDetails> {
    return httpClient.post<PlaceDetails>("/places/details", { placeId });
  },
};
