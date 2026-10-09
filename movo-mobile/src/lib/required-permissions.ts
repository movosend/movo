// `Camera` está marcado `@hidden` en expo-camera 57 pero sigue siendo la única API
// imperativa de permisos del paquete: `useCameraPermissions` es un hook y no sirve
// desde una función async como las de acá. Mismo import que ya usaba el carrusel.
import { Camera } from "expo-camera";
import * as Location from "expo-location";
import { Linking } from "react-native";

/**
 * Permisos del SO que Movo trata como **obligatorios y bloqueantes** (MOVO-249):
 * sin ubicación no hay validación de proximidad del handshake de custodia
 * (MOVO-158/160) ni ruta/tracking, y sin cámara no hay escaneo de QR ni evidencia
 * fotográfica del retiro/entrega (MOVO-197). Son el núcleo del producto, no un
 * "nice to have" — por eso ni el carrusel de onboarding ni la app ya autenticada
 * dejan seguir sin ellos.
 *
 * Notificaciones queda deliberadamente FUERA de esta lista: es el único de los 3
 * permisos del carrusel que sigue siendo opcional ("Ahora no"), porque nada del
 * flujo de un envío se rompe sin push — solo se entera más tarde.
 *
 * Nota para la defensa/ADR: bloquear la app entera detrás de estos dos permisos es
 * una decisión de producto con riesgo conocido frente a la guideline 5.1.1(iv) de
 * Apple (y su equivalente de Google Play), que pide que una app siga siendo usable
 * si el usuario deniega un permiso. Se asume a propósito, documentado acá en vez de
 * quedar implícito.
 */
export const REQUIRED_PERMISSION_KINDS = ["location", "camera"] as const;

export type RequiredPermissionKind = (typeof REQUIRED_PERMISSION_KINDS)[number];

export interface PermissionSnapshot {
  granted: boolean;
  /** `false` = denegado de forma permanente, el SO ya no vuelve a preguntar — el
   * único camino es Ajustes. Mismo shape que `getNotificationPermissionStatus()`
   * (`notification-permission.ts`) y `takePhotoWithCamera()` (`photo-utils.ts`). */
  canAskAgain: boolean;
}

export type RequiredPermissionsSnapshot = Record<RequiredPermissionKind, PermissionSnapshot>;

/** Un fallo al LEER/PEDIR el permiso (módulo nativo ausente, excepción del SO) se
 * trata como "no concedido pero reintentable", nunca como bloqueado: mandar a
 * Ajustes a alguien cuyo permiso en realidad nunca se consultó lo deja sin salida
 * real (en Ajustes vería el permiso ya concedido y el gate seguiría trabado). */
const RETRYABLE_DENIAL: PermissionSnapshot = { granted: false, canAskAgain: true };

function normalize(permission: { granted: boolean; canAskAgain: boolean }): PermissionSnapshot {
  return { granted: permission.granted, canAskAgain: permission.canAskAgain };
}

/** Lectura de solo lectura: nunca dispara el diálogo nativo (mismo criterio que
 * `getNotificationPermissionStatus`). Es lo que consume el gate global, que corre en
 * cada apertura/vuelta a foreground de la app y no puede interrumpir con un prompt. */
export async function getRequiredPermissionStatus(
  kind: RequiredPermissionKind,
): Promise<PermissionSnapshot> {
  try {
    const permission =
      kind === "location"
        ? await Location.getForegroundPermissionsAsync()
        : await Camera.getCameraPermissionsAsync();
    return normalize(permission);
  } catch {
    return RETRYABLE_DENIAL;
  }
}

export async function getRequiredPermissionsStatus(): Promise<RequiredPermissionsSnapshot> {
  const [location, camera] = await Promise.all([
    getRequiredPermissionStatus("location"),
    getRequiredPermissionStatus("camera"),
  ]);
  return { location, camera };
}

/** Dispara el diálogo nativo. Si el SO ya no puede volver a preguntar
 * (`canAskAgain: false`) la llamada resuelve de inmediato sin mostrar nada — el
 * caller tiene que mandar a Ajustes en ese caso, no reintentar en loop. */
export async function requestRequiredPermission(
  kind: RequiredPermissionKind,
): Promise<PermissionSnapshot> {
  try {
    const permission =
      kind === "location"
        ? await Location.requestForegroundPermissionsAsync()
        : await Camera.requestCameraPermissionsAsync();
    return normalize(permission);
  } catch {
    return RETRYABLE_DENIAL;
  }
}

export function missingRequiredPermissions(
  snapshot: RequiredPermissionsSnapshot,
): RequiredPermissionKind[] {
  return REQUIRED_PERMISSION_KINDS.filter((kind) => !snapshot[kind].granted);
}

/** Abre la ficha de la app en Ajustes del SO — único camino cuando el permiso quedó
 * denegado de forma permanente. Nunca lanza: que falle abrir Ajustes no puede
 * romper la pantalla que lo ofrece. */
export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Sin fallback posible: el gate sigue visible y el usuario puede reintentar.
  }
}

/** Copy de cada permiso obligatorio, compartido por el carrusel (MOVO-249) y el gate
 * global — una sola redacción, para que el usuario lea exactamente el mismo motivo
 * la primera vez y cada vez que lo revoque. */
export const REQUIRED_PERMISSION_COPY: Record<
  RequiredPermissionKind,
  { label: string; why: string; grantLabel: string }
> = {
  location: {
    label: "Ubicación",
    why: "Movo valida por GPS que las dos personas están en el mismo lugar al entregar un paquete. Sin ubicación no podemos confirmar ningún envío.",
    grantLabel: "Activar ubicación",
  },
  camera: {
    label: "Cámara",
    why: "La cámara se usa para escanear el código del envío y registrar el estado del paquete al retirarlo y entregarlo.",
    grantLabel: "Permitir cámara",
  },
};
