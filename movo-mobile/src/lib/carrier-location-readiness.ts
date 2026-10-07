import * as Location from "expo-location";
import { Platform } from "react-native";
import { openAppSettings } from "./required-permissions";

/**
 * Requisitos de ubicación para **operar como transportista** — un escalón por encima
 * de los permisos obligatorios de toda la app (`required-permissions.ts`, que solo
 * exigen ubicación con la app abierta). Sin ubicación en segundo plano el tracking del
 * viaje (MOVO-203/242) se corta apenas se apaga la pantalla o se abre Waze/Maps, y sin
 * ubicación precisa la validación de proximidad del handshake (100m, MOVO-158) falla
 * sin un motivo claro para el usuario.
 *
 * El orden importa: es el orden en que se resuelven. No se puede pedir segundo plano
 * sin primer plano (lo exige el SO), y no tiene sentido pedir permisos con el GPS del
 * teléfono apagado.
 */
export const CARRIER_LOCATION_REQUIREMENTS = [
  "services",
  "foreground",
  "precise",
  "background",
] as const;

export type CarrierLocationRequirement = (typeof CARRIER_LOCATION_REQUIREMENTS)[number];

export interface CarrierLocationReadiness {
  servicesEnabled: boolean;
  foregroundGranted: boolean;
  foregroundCanAskAgain: boolean;
  precise: boolean;
  backgroundGranted: boolean;
  backgroundCanAskAgain: boolean;
}

/** Un fallo al leer se trata como "falta", nunca como concedido: dejar operar a
 * alguien cuyo permiso no se pudo verificar sería justo el hueco que esto cierra. */
const UNKNOWN_READINESS: CarrierLocationReadiness = {
  servicesEnabled: false,
  foregroundGranted: false,
  foregroundCanAskAgain: true,
  precise: false,
  backgroundGranted: false,
  backgroundCanAskAgain: true,
};

/** iOS 14+ ("Ubicación exacta" apagada) y Android 12+ ("Aproximada") permiten conceder
 * ubicación sin precisión. Sin el dato de plataforma (SO viejo) se asume precisa: ahí
 * no existe la opción de reducirla. */
export function isPreciseLocation(permission: Location.LocationPermissionResponse): boolean {
  if (permission.ios) return permission.ios.accuracy !== "reduced";
  if (permission.android) return permission.android.accuracy === "fine";
  return true;
}

/** Lectura de solo lectura: nunca dispara un diálogo nativo. */
export async function getCarrierLocationReadiness(): Promise<CarrierLocationReadiness> {
  try {
    const [servicesEnabled, foreground, background] = await Promise.all([
      Location.hasServicesEnabledAsync(),
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    return {
      servicesEnabled,
      foregroundGranted: foreground.granted,
      foregroundCanAskAgain: foreground.canAskAgain,
      precise: foreground.granted && isPreciseLocation(foreground),
      backgroundGranted: background.granted,
      backgroundCanAskAgain: background.canAskAgain,
    };
  } catch {
    return UNKNOWN_READINESS;
  }
}

export function isRequirementMet(
  readiness: CarrierLocationReadiness,
  requirement: CarrierLocationRequirement,
): boolean {
  switch (requirement) {
    case "services":
      return readiness.servicesEnabled;
    case "foreground":
      return readiness.foregroundGranted;
    case "precise":
      return readiness.precise;
    case "background":
      return readiness.backgroundGranted;
  }
}

/** Primer requisito sin cumplir, en el orden de `CARRIER_LOCATION_REQUIREMENTS`, o
 * `null` si el transportista ya puede operar. */
export function firstMissingRequirement(
  readiness: CarrierLocationReadiness,
): CarrierLocationRequirement | null {
  return CARRIER_LOCATION_REQUIREMENTS.find((req) => !isRequirementMet(readiness, req)) ?? null;
}

/**
 * Si resolver el requisito pasa sí o sí por Ajustes del SO (en vez de un diálogo
 * nativo dentro de la app). `alreadyAttempted` cubre el caso que el SO no informa
 * bien: iOS muestra el "Cambiar a Permitir siempre" una sola vez en la vida de la
 * app y después `requestBackgroundPermissionsAsync` resuelve sin mostrar nada — si ya
 * lo pedimos en esta sesión y sigue faltando, reintentar sería un botón que no hace
 * nada.
 */
export function requirementNeedsSettings(
  readiness: CarrierLocationReadiness,
  requirement: CarrierLocationRequirement,
  alreadyAttempted: boolean,
): boolean {
  if (alreadyAttempted) return true;
  switch (requirement) {
    // En iOS no hay forma pública de abrir directo "Servicios de localización"; en
    // Android sí hay diálogo propio (`enableNetworkProviderAsync`).
    case "services":
      return Platform.OS === "ios";
    case "foreground":
      return !readiness.foregroundCanAskAgain;
    // iOS: la precisión solo se cambia desde Ajustes (pedirla temporalmente exige
    // `NSLocationTemporaryUsageDescriptionDictionary`, que no está configurado y
    // además solo dura la sesión). Android: volver a pedir el permiso de primer plano
    // ofrece pasar de aproximada a precisa.
    case "precise":
      return Platform.OS === "ios" || !readiness.foregroundCanAskAgain;
    case "background":
      return !readiness.backgroundCanAskAgain;
  }
}

/**
 * Ejecuta la acción que resuelve un requisito: el diálogo nativo si todavía se puede,
 * o Ajustes si no. Nunca lanza — el caller relee el estado después (o al volver a
 * foreground desde Ajustes) en vez de confiar en el resultado de esta llamada.
 */
export async function resolveCarrierLocationRequirement(
  readiness: CarrierLocationReadiness,
  requirement: CarrierLocationRequirement,
  alreadyAttempted: boolean,
): Promise<void> {
  if (requirementNeedsSettings(readiness, requirement, alreadyAttempted)) {
    await openAppSettings();
    return;
  }
  try {
    switch (requirement) {
      case "services":
        await Location.enableNetworkProviderAsync();
        return;
      case "foreground":
      case "precise":
        await Location.requestForegroundPermissionsAsync();
        return;
      case "background":
        // En Android 11+ esto abre la pantalla de permisos de la app (no hay diálogo
        // con "Permitir todo el tiempo"); en iOS, el aviso de "Cambiar a Permitir
        // siempre". Ambos casos los explica la pantalla antes de llegar acá.
        await Location.requestBackgroundPermissionsAsync();
        return;
    }
  } catch {
    // El usuario rechazó el diálogo de Android de activar la ubicación, o el SO
    // falló: el estado se relee igual y la pantalla sigue ofreciendo el paso.
  }
}
