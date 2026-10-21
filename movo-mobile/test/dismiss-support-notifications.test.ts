import * as Notifications from "expo-notifications";
import { dismissSupportNotifications } from "../src/lib/dismiss-support-notifications";

jest.mock("expo-notifications", () => ({
  getPresentedNotificationsAsync: jest.fn(),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
}));

const presented = (identifier: string, data: Record<string, unknown>) => ({ request: { identifier, content: { data } } });

describe("dismissSupportNotifications (MOVO-324)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("saca solo las notificaciones de soporte de esa consulta", async () => {
    (Notifications.getPresentedNotificationsAsync as jest.Mock).mockResolvedValue([
      presented("a", { type: "support_message", conversationId: "c1" }),
      presented("b", { type: "support_message", conversationId: "c2" }),
      presented("c", { type: "chat_message", shipmentId: "c1" }),
      presented("d", { type: "support_message", conversationId: "c1" }),
    ]);

    await dismissSupportNotifications("c1");

    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledTimes(2);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("a");
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("d");
  });

  it("si el sistema no lo permite no falla", async () => {
    (Notifications.getPresentedNotificationsAsync as jest.Mock).mockRejectedValue(new Error("no soportado"));
    await expect(dismissSupportNotifications("c1")).resolves.toBeUndefined();
  });
});
