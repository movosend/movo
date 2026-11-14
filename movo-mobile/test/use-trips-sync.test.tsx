import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import { AppState, Text } from "react-native";
import { useTripsSync } from "../src/hooks/use-trips-sync";
import { TRIPS_LIST_QUERY_KEY } from "../src/hooks/use-trips";

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
  useTripsSync();
  return <Text>x</Text>;
}

describe("useTripsSync (feedback de TestFlight, build 17)", () => {
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

  it("una push shipment_cancelled en foreground vuelve a pedir los viajes", async () => {
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type: "shipment_cancelled", shipmentId: "s1" } } } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: TRIPS_LIST_QUERY_KEY });
  });

  it("una push dispute_opened también: la disputa puede haber completado el viaje en curso", async () => {
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type: "dispute_opened", shipmentId: "s1", disputeId: "d1" } } } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: TRIPS_LIST_QUERY_KEY });
  });

  it("otras push no tocan los viajes", async () => {
    await mount();
    const listener = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    listener({ request: { content: { data: { type: "chat_message", shipmentId: "s1" } } } });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("al volver la app a primer plano refresca los viajes", async () => {
    await mount();
    appStateHandler("background");
    expect(invalidate).not.toHaveBeenCalled();
    appStateHandler("active");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: TRIPS_LIST_QUERY_KEY });
  });

  it("sin sesión no se suscribe", async () => {
    mockStatus = "unauthenticated";
    await mount();
    expect(mockAddReceived).not.toHaveBeenCalled();
  });
});
