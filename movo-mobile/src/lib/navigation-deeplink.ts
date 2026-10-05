import { Linking, Platform } from "react-native";

export interface NavigationTarget {
  lat: number;
  lng: number;
}

type NavigationPlatform = "ios" | "android";

/**
 * URLs candidatas para navegar hasta una parada (MOVO-237, ADR-033), en el orden de
 * fallback del AC2: Google Maps nativo → Waze → Google Maps web. La navegación real la
 * resuelve la app externa, así que esto nunca llama a Compute Routes ni al Navigation
 * SDK (AC3) — es la razón por la que el modo `live` del `RoutesProvider` de
 * `svc-shipments` quedó como placeholder.
 */
export function buildNavigationCandidates(
  target: NavigationTarget,
  platform: NavigationPlatform,
): string[] {
  const coords = `${target.lat},${target.lng}`;
  const googleMapsNative =
    platform === "android"
      ? `google.navigation:q=${coords}`
      : `comgooglemaps://?daddr=${coords}&directionsmode=driving`;
  return [
    googleMapsNative,
    `waze://?ll=${coords}&navigate=yes`,
    `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=driving`,
  ];
}

/** Recorrido completo: origen opcional + paradas en orden (la última es el destino final). */
export interface NavigationRoute {
  origin?: NavigationTarget | null;
  stops: NavigationTarget[];
}

/** Google Maps web acepta hasta 9 waypoints intermedios en la URL. */
const MAX_WAYPOINTS = 9;

const coordsOf = (t: NavigationTarget) => `${t.lat},${t.lng}`;

/**
 * URLs candidatas para ver el recorrido completo, misma cascada que
 * `buildNavigationCandidates`: Google Maps nativo → Waze → Google Maps web.
 *
 * - Google Maps iOS: `comgooglemaps://` admite varias paradas encadenadas con `+to:`.
 * - Google Maps Android: no existe un scheme nativo con waypoints, así que se usa un
 *   `intent://` que fuerza el paquete de Google Maps sobre la misma URL web.
 * - Waze no admite waypoints: abre la navegación a la PRIMERA parada, que es la que sigue.
 */
export function buildRouteCandidates(
  route: NavigationRoute,
  platform: NavigationPlatform,
): string[] {
  const stops = route.stops;
  if (stops.length === 0) return [];
  const destination = stops[stops.length - 1];
  const intermediates = stops.slice(0, -1).slice(0, MAX_WAYPOINTS);
  const origin = route.origin ?? null;

  const webQuery =
    `api=1${origin ? `&origin=${coordsOf(origin)}` : ""}` +
    `&destination=${coordsOf(destination)}` +
    (intermediates.length > 0
      ? `&waypoints=${intermediates.map(coordsOf).join("%7C")}`
      : "") +
    "&travelmode=driving";
  const web = `https://www.google.com/maps/dir/?${webQuery}`;

  const googleMapsNative =
    platform === "android"
      ? `intent://www.google.com/maps/dir/?${webQuery}#Intent;scheme=https;package=com.google.android.apps.maps;end`
      : `comgooglemaps://?${origin ? `saddr=${coordsOf(origin)}&` : ""}daddr=${[
          ...intermediates,
          destination,
        ]
          .map(coordsOf)
          .join("+to:")}&directionsmode=driving`;

  return [googleMapsNative, `waze://?ll=${coordsOf(stops[0])}&navigate=yes`, web];
}

/**
 * Prueba `Linking.openURL` en cascada en vez de preguntar con `canOpenURL`: este último
 * exige declarar los schemes (`LSApplicationQueriesSchemes` en iOS, `<queries>` en
 * Android 11+), o sea un build nativo nuevo, mientras que `openURL` ya rechaza por sí
 * solo cuando ninguna app instalada maneja la URL — mismo orden de fallback, sin tocar
 * config nativa.
 *
 * @returns la URL que se terminó abriendo, o `null` si ninguna fue aceptada.
 */
async function openFirstAvailable(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return url;
    } catch (err) {
      // Normalmente "app no instalada": probar la siguiente candidata, dejando traza del motivo.
      console.warn("[navigation] openURL rechazó", url, err);
    }
  }
  return null;
}

const isValid = (t: NavigationTarget) => Number.isFinite(t.lat) && Number.isFinite(t.lng);

const currentPlatform = (): NavigationPlatform => (Platform.OS === "android" ? "android" : "ios");

/**
 * Abre la primera app de navegación que acepte el deep-link hacia una parada.
 *
 * @returns la URL que se terminó abriendo, o `null` si las coordenadas son inválidas o ni
 * el browser la aceptó (el llamador avisa al usuario).
 */
export async function openNavigation(target: NavigationTarget): Promise<string | null> {
  // Coordenadas inválidas (NaN/Infinity) armarían una URL rota que igual "abre": cortar acá.
  if (!isValid(target)) {
    console.warn("[navigation] coordenadas inválidas, no se abre la navegación", target);
    return null;
  }
  return openFirstAvailable(buildNavigationCandidates(target, currentPlatform()));
}

/** Igual que `openNavigation`, pero para el recorrido completo con todas las paradas. */
export async function openRoute(route: NavigationRoute): Promise<string | null> {
  if (route.stops.length === 0 || !route.stops.every(isValid) || (route.origin && !isValid(route.origin))) {
    console.warn("[navigation] recorrido vacío o con coordenadas inválidas", route);
    return null;
  }
  return openFirstAvailable(buildRouteCandidates(route, currentPlatform()));
}
