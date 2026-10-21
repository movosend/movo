import * as Notifications from "expo-notifications";

/**
 * MOVO-301: al abrir una conversación se sacan de la bandeja las notificaciones de ese chat, como WhatsApp:
 * ya se vieron, y dejarlas ahí (una por ráfaga) llena el centro de notificaciones. Solo las `chat_message` de ese
 * envío; el resto de las notificaciones de la app no se tocan. Best-effort: si el sistema no lo permite, no pasa nada.
 */
export async function dismissChatNotifications(shipmentId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((notification) => {
          const data = notification.request?.content?.data as { type?: unknown; shipmentId?: unknown } | undefined;
          return data?.type === "chat_message" && data.shipmentId === shipmentId;
        })
        .map((notification) => Notifications.dismissNotificationAsync(notification.request.identifier)),
    );
  } catch {
    // Sin permiso o sin soporte (Expo Go): no es un error de la conversación.
  }
}
