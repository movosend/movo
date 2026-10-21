import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { supportKeys } from "../src/hooks/use-support";
import { useSupportUnreadSync } from "../src/hooks/use-support-unread-sync";

let mockReceived: ((n: unknown) => void) | null = null;
const mockRemove = jest.fn();
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (cb: (n: unknown) => void) => {
    mockReceived = cb;
    return { remove: mockRemove };
  },
}));

let mockStatus = "authenticated";
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ status: mockStatus }),
}));

const push = (data: Record<string, unknown>) => ({ request: { content: { data } } });

describe("useSupportUnreadSync (MOVO-324)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = "authenticated";
    mockReceived = null;
  });

  async function setup() {
    const client = new QueryClient();
    client.setQueryData(supportKeys.list, {
      items: [
        { id: "c1", unreadCount: 0 },
        { id: "c2", unreadCount: 1 },
      ],
    });
    const invalidate = jest.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = await renderHook(() => useSupportUnreadSync(), { wrapper });
    return { client, invalidate, ...view };
  }

  it("una push de soporte con la app abierta suma un no leído a esa consulta y refresca la lista", async () => {
    const { client, invalidate } = await setup();

    mockReceived?.(push({ type: "support_message", conversationId: "c1" }));

    const items = (client.getQueryData(supportKeys.list) as { items: { id: string; unreadCount: number }[] }).items;
    expect(items.find((i) => i.id === "c1")?.unreadCount).toBe(1);
    expect(items.find((i) => i.id === "c2")?.unreadCount).toBe(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: supportKeys.list });
  });

  it("ignora las push de otros tipos", async () => {
    const { invalidate } = await setup();
    mockReceived?.(push({ type: "chat_message", shipmentId: "s1" }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("al volver a primer plano refresca la lista", async () => {
    let appStateListener: ((s: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, cb: (s: string) => void) => {
      appStateListener = cb;
      return { remove: jest.fn() };
    }) as never);
    const { invalidate } = await setup();

    appStateListener?.("active");

    expect(invalidate).toHaveBeenCalledWith({ queryKey: supportKeys.list });
  });

  it("sin sesión no se suscribe, y al desmontar se desuscribe", async () => {
    mockStatus = "unauthenticated";
    await setup();
    expect(mockReceived).toBeNull();

    mockStatus = "authenticated";
    const { unmount } = await setup();
    await unmount();
    expect(mockRemove).toHaveBeenCalled();
  });
});
