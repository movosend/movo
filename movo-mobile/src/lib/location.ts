import * as Location from "expo-location";

/** Cuánto se espera un fix de alta precisión antes de caer a la precisión balanceada: bajo techo
 * el GPS puede tardar mucho o no resolver nunca, y el paso del handshake quedaba en "confirming". */
export const HIGH_ACCURACY_TIMEOUT_MS = 10_000;

const TIMED_OUT = Symbol("timed-out");

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type CurrentLocationResult =
  | { granted: true; lat: number; lng: number }
  | { granted: false };

/** Pide permiso de ubicación en foreground y devuelve la posición actual del
 * dispositivo — "Usar mi ubicación" en el paso de direcciones del wizard de envíos
 * (MOVO-83). Mismo patrón permiso-then-branch que `photo-utils.ts` (`takePhotoWithCamera`/
 * `pickPhotoFromGallery`): nunca lanza por un permiso denegado, el caller decide qué
 * mostrar. No hace reverse-geocoding — solo fija `lat`/`lng`, el caller es responsable
 * de un label de dirección (p.ej. "Ubicación actual") si el usuario no escribe uno.
 * `highAccuracy` lo pide el handshake (DD-062): el servidor compara dos posiciones a 100 m, y un
 * GPS impreciso en cualquiera de los dos teléfonos rechaza a dos personas que están juntas. Si el fix
 * de alta precisión no llega en `HIGH_ACCURACY_TIMEOUT_MS`, se pide uno balanceado: mejor una posición
 * menos precisa (que el servidor puede rechazar con un mensaje) que una pantalla trabada. */
export async function getCurrentLocation(options?: { highAccuracy?: boolean }): Promise<CurrentLocationResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    return { granted: false };
  }

  let position: Location.LocationObject;
  if (options?.highAccuracy) {
    const precise = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      HIGH_ACCURACY_TIMEOUT_MS,
    );
    position =
      precise === TIMED_OUT
        ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        : precise;
  } else {
    position = await Location.getCurrentPositionAsync({});
  }
  return {
    granted: true,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  };
}
