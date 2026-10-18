import * as Notifications from "expo-notifications";
import { dismissChatNotifications } from "../src/lib/dismiss-chat-notifications";

jest.mock("expo-notifications", () => ({
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
}));

const presented = (identifier: string, data: Record<string, unknown>) => ({ request: { identifier, content: { data } } });

describe("dismissChatNotifications (MOVO-301)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("saca solo las notificaciones de chat de ese envío", async () => {
    (Notifications.getPresentedNotificationsAsync as jest.Mock).mockResolvedValue([
      presented("a", { type: "chat_message", shipmentId: "s1" }),
      presented("b", { type: "chat_message", shipmentId: "s2" }),
      presented("c", { type: "offer_created", shipmentId: "s1" }),
      presented("d", { type: "chat_message", shipmentId: "s1" }),
    ]);

    await dismissChatNotifications("s1");

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(2);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("a");
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("d");
  });

  it("si el sistema no lo permite no falla", async () => {
    (Notifications.getPresentedNotificationsAsync as jest.Mock).mockRejectedValue(new Error("no soportado"));
    await expect(dismissChatNotifications("s1")).resolves.toBeUndefined();
  });
});
