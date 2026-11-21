import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import { AppState, Text } from "react-native";
import { useShipmentsSync } from "../src/hooks/use-shipments-sync";

let mockStatus = "authenticated";
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => selector({ status: mockStatus }),
}));

const mockAddReceived = jest.fn();
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (...args: unknown[]) => mockAddReceived(...args),
}));

function Probe() {
  useShipmentsSync();
  return <Text>x</Text>;
}

/** Lo que tiene que quedar al día cuando se resuelve una disputa (revisión del PR de MOVO-362). */
const EXPECTED_KEYS = [
  ["shipments", "detail"],
  ["shipments", "events"],
  ["shipments", "mine"],
  ["shipments", "active"],
  ["shipments", "transporting"],
  ["chat", "list"],
  ["chat", "messages"],
  ["offers", "mine"],
];

describe("useShipmentsSync (feedback de TestFlight, build 19)", () => {
  let queryClient: QueryClient;
  let invalidate: jest.SpyInstance;
  let appStateHandler: (state: string) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = "authenticated";
    queryClient = new QueryClient();
    invalidate = jest.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
    mockAddReceived.mockReturnValue({ remove: jest.fn() });
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

  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => (filters as { queryKey: unknown }).queryKey);

  it.each(["dispute_opened", "dispute_resolved"])("una push %s en primer plano refresca el envío, los chats y las ofertas", async (type) => {
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type, shipmentId: "s1", disputeId: "d1" } } } });
    expect(invalidatedKeys()).toEqual(EXPECTED_KEYS);
  });

  it("otras push no refrescan nada", async () => {
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type: "chat_message", shipmentId: "s1" } } } });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("al volver a primer plano refresca: la push pudo llegar con la app en segundo plano y el chat seguir montado", async () => {
    await mount();
    appStateHandler("background");
    expect(invalidate).not.toHaveBeenCalled();
    appStateHandler("active");
    expect(invalidatedKeys()).toEqual(EXPECTED_KEYS);
  });

  it("sin sesión no se suscribe", async () => {
    mockStatus = "unauthenticated";
    await mount();
    expect(mockAddReceived).not.toHaveBeenCalled();
  });
});
