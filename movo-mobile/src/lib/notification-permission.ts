import * as Notifications from "expo-notifications";

export interface NotificationPermissionStatus {
  granted: boolean;
  /** `false` = denegado de forma permanente, el SO ya no vuelve a preguntar (mismo
   * shape que `takePhotoWithCamera`/`ImagePicker`, `src/lib/photo-utils.ts`). */
  canAskAgain: boolean;
}

/**
 * Lectura de solo lectura del permiso de push del SO (AC4 de MOVO-246: indicar
 * explícitamente si está bloqueado, sin dejar toggles prendidos sin efecto real) —
 * a diferencia de `push-registration.ts#requestPermissionAndRegisterPushToken`, que
 * SÍ pide el permiso, esto nunca dispara el prompt nativo, solo consulta el estado
 * actual (para no volver a interrumpir al usuario cada vez que abre esta pantalla).
 */
export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  const permission = await Notifications.getPermissionsAsync();
  return { granted: permission.granted, canAskAgain: permission.canAskAgain };
}
