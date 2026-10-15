import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import { AppState } from "react-native";
import { Text } from "react-native";
import { useChatUnreadSync } from "../src/hooks/use-chat-unread-sync";
import { chatKeys } from "../src/hooks/use-chat";

let mockStatus = "authenticated";
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => selector({ status: mockStatus }),
}));

const mockRemoveReceived = jest.fn();
const mockAddReceived = jest.fn();
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (...args: unknown[]) => mockAddReceived(...args),
}));

function Probe() {
  useChatUnreadSync();
  return <Text>x</Text>;
}

describe("useChatUnreadSync (MOVO-301)", () => {
  let queryClient: QueryClient;
  let invalidate: jest.SpyInstance;
  let appStateHandler: (state: string) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = "authenticated";
    queryClient = new QueryClient();
    invalidate = jest.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    mockAddReceived.mockReturnValue({ remove: mockRemoveReceived });
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, handler: (state: string) => void) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    }) as never);
  });

  const mount = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

  it("una push chat_message en foreground vuelve a pedir la lista de chats", async () => {
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type: "chat_message", shipmentId: "s1" } } } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list });
  });

  it("la push suma un no leído al instante, sin esperar a la lista del servidor", async () => {
    queryClient.setQueryData(chatKeys.list, {
      items: [
        { shipmentId: "s1", unreadCount: 1 },
        { shipmentId: "s2", unreadCount: 0 },
      ],
    });
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type: "chat_message", shipmentId: "s1" } } } });

    const cached = queryClient.getQueryData<{ items: { shipmentId: string; unreadCount: number }[] }>(chatKeys.list);
    expect(cached?.items.find((i) => i.shipmentId === "s1")?.unreadCount).toBe(2);
    expect(cached?.items.find((i) => i.shipmentId === "s2")?.unreadCount).toBe(0);
  });

  it("otras push no tocan la lista", async () => {
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type: "offer_created" } } } });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("al volver la app a primer plano refresca la lista", async () => {
    await mount();
    appStateHandler("background");
    expect(invalidate).not.toHaveBeenCalled();
    appStateHandler("active");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.list });
  });

  it("sin sesión no se suscribe", async () => {
    mockStatus = "unauthenticated";
    await mount();
    expect(mockAddReceived).not.toHaveBeenCalled();
  });
});
