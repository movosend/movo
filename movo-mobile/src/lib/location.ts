import * as Location from "expo-location";

export type CurrentLocationResult =
  | { granted: true; lat: number; lng: number }
  | { granted: false };

/** Pide permiso de ubicación en foreground y devuelve la posición actual del
 * dispositivo — "Usar mi ubicación" en el paso de direcciones del wizard de envíos
 * (MOVO-83). Mismo patrón permiso-then-branch que `photo-utils.ts` (`takePhotoWithCamera`/
 * `pickPhotoFromGallery`): nunca lanza por un permiso denegado, el caller decide qué
 * mostrar. No hace reverse-geocoding — solo fija `lat`/`lng`, el caller es responsable
 * de un label de dirección (p.ej. "Ubicación actual") si el usuario no escribe uno. */
export async function getCurrentLocation(): Promise<CurrentLocationResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    return { granted: false };
  }

  const position = await Location.getCurrentPositionAsync({});
  return {
    granted: true,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  };
}
