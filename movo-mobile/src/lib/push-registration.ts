import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { notificationsClient, type PushPlatform } from "../api/notifications-client";
import { getOrCreateDeviceId } from "./device-id";

/**
 * Funciones puras de registro/baja de push token (MOVO-107) — separadas del hook de
 * React (`src/hooks/use-push-notifications.ts`) para que `src/store/auth-store.ts`
 * pueda invocar `unregisterCurrentDevice()` desde `logout()` sin importar un hook.
 *
 * AC7: en Expo Go (sin development build) `getExpoPushTokenAsync` tira igual, aunque
 * `extra.eas.projectId` ya esté configurado en `app.config.js` (proyecto "movo-mobile"
 * de la org "movosend" en EAS) — Expo Go no soporta push remoto. Se atrapa acá mismo:
 * el registro de push es un paso secundario, nunca puede romper el arranque de la app
 * ni ningún otro flujo.
 */

function log(message: string, error?: unknown): void {
  if (error !== undefined) {
    console.warn(`[push] ${message}`, error);
  } else {
    console.warn(`[push] ${message}`);
  }
}

function currentPlatform(): PushPlatform | null {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    return Platform.OS;
  }
  return null;
}

/** AC1/AC2/AC3: pide permiso y, si se concede, obtiene el push token de Expo y lo
 * registra contra el backend. No devuelve/lanza nada que el caller tenga que manejar
 * — cualquier fallo en cualquier paso queda logueado y no-op, a propósito (AC1: no es
 * un muro; AC7: nunca rompe el arranque). */
export async function requestPermissionAndRegisterPushToken(): Promise<void> {
  const platform = currentPlatform();
  if (!platform) {
    return;
  }

  let permissionStatus: Notifications.PermissionStatus;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    permissionStatus = status;
  } catch (error) {
    log("no se pudo pedir permiso de notificaciones", error);
    return;
  }

  if (permissionStatus !== "granted") {
    log(`permiso de notificaciones no concedido (status: ${permissionStatus})`);
    return;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;

  let expoPushToken: string;
  try {
    expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (error) {
    // Expo Go (ver comentario de arriba) — esperado en ese entorno, no es un error
    // real de la app.
    log("no se pudo obtener el push token de Expo (¿Expo Go?)", error);
    return;
  }

  try {
    const deviceId = await getOrCreateDeviceId();
    await notificationsClient.registerPushToken({ expoPushToken, deviceId, platform });
  } catch (error) {
    log("no se pudo registrar el push token contra el backend", error);
  }
}

/** AC4: se llama desde `auth-store.ts#logout()` antes de limpiar la sesión — con la
 * sesión todavía viva para que `httpClient` adjunte `Authorization`. Tolera cualquier
 * fallo (mismo criterio que el resto de `logout()`: un paso secundario no bloquea
 * salir de la cuenta). */
export async function unregisterCurrentDevice(): Promise<void> {
  try {
    const deviceId = await getOrCreateDeviceId();
    await notificationsClient.unregisterPushToken(deviceId);
  } catch (error) {
    log("no se pudo dar de baja el push token al hacer logout", error);
  }
}
