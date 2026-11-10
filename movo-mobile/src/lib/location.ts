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
  | { granted: true; lat: number; lng: number; heading?: number }
  | { granted: false };

/** Por debajo de esta velocidad (m/s, ~7 km/h) el rumbo del GPS no es confiable: quieto o a paso de
 * hombre, el dispositivo informa uno cualquiera. */
const MIN_SPEED_FOR_HEADING_MPS = 2;

/** Rumbo en grados enteros (0-359), solo si el GPS lo informa y el dispositivo se está moviendo.
 * iOS manda `-1` cuando no lo sabe, Android `null` o `0` exacto (`getBearing()` sin dato): el `0`
 * exacto se descarta también, a costa de perder el norte justo, que en la práctica llega como 0.x.
 * Lo usan `my-route`, para que Google no arme la ruta en la dirección contraria a la que va el auto, y
 * el recorte de "Mi ruta", para no confundir la ida con la vuelta por la misma calle (MOVO-357). */
export function headingFromCoords(coords: Pick<Location.LocationObjectCoords, "heading" | "speed">): number | undefined {
  const { heading, speed } = coords;
  if (heading === null || heading === undefined || !Number.isFinite(heading) || heading <= 0) return undefined;
  if (speed === null || speed === undefined || speed < MIN_SPEED_FOR_HEADING_MPS) return undefined;
  return Math.round(heading) % 360;
}

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
  const heading = headingFromCoords(position.coords);
  return {
    granted: true,
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    ...(heading === undefined ? {} : { heading }),
  };
}

/**
 * Sigue la posición del dispositivo en primer plano mientras el caller la necesite (el mapa de "Mi
 * ruta" con el viaje en curso: feedback de TestFlight build 18, el ícono del transportista no se
 * movía). Solo con el permiso ya concedido: no lo pide (lo pidió `getCurrentLocation` al entrar).
 * Devuelve la función para cortar la suscripción; si no hay permiso o falla, una que no hace nada.
 * No reemplaza a la tarea de background que publica la posición al servidor.
 * MOVO-357: precisión alta (Balanced en iOS anda en ~100 m: el ícono saltaba entre calles y el recorte
 * de la ruta caía en la calle de al lado). Solo dura lo que la pantalla esté enfocada, así que el costo
 * de batería queda acotado. Pasa también el rumbo, cuando el auto se mueve (`headingFromCoords`).
 */
export async function watchForegroundLocation(
  onChange: (coords: { lat: number; lng: number; heading?: number }) => void,
): Promise<() => void> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return () => undefined;
    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 3_000, distanceInterval: 10 },
      (position) => {
        const heading = headingFromCoords(position.coords);
        onChange({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          ...(heading === undefined ? {} : { heading }),
        });
      },
    );
    return () => subscription.remove();
  } catch {
    return () => undefined;
  }
}
