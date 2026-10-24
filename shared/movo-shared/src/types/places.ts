/**
 * Wire contract de `POST /places/autocomplete` (`movo-svc-users`, MOVO-83). MOVO-340 lo
 * mueve acá desde el adapter del servicio y el cliente mobile, que lo tenían duplicado.
 *
 * `lat`/`long` solo vienen cuando el texto buscado eran coordenadas (`-31.4201, -64.1888`
 * o `31°25'12.4"S 64°11'19.7"W`): la sugerencia ya trae el punto que escribió el usuario
 * y el cliente no llama a `/places/details`. `description` es la dirección del reverse
 * geocoding, o las mismas coordenadas si no hubo dirección. Una predicción de Google
 * nunca las trae.
 */
export interface PlacePrediction {
  placeId: string;
  description: string;
  lat?: number;
  long?: number;
}
