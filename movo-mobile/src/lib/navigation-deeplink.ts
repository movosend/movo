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
