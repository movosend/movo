import * as Notifications from "expo-notifications";

/**
 * MOVO-324: al abrir una consulta se sacan de la bandeja las notificaciones de esa consulta (`support_message`), como
 * `dismissChatNotifications` con el chat del envío. El resto de las notificaciones no se tocan. Best-effort.
 */
export async function dismissSupportNotifications(conversationId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((notification) => {
          const data = notification.request?.content?.data as { type?: unknown; conversationId?: unknown } | undefined;
          return data?.type === "support_message" && data.conversationId === conversationId;
        })
        .map((notification) => Notifications.dismissNotificationAsync(notification.request.identifier)),
    );
  } catch {
    // Sin permiso o sin soporte (Expo Go): no es un error de la conversación.
  }
}
