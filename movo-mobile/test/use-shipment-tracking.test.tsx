import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react-native";
import { shipmentsClient } from "../src/api/shipments-client";
import { useShipmentTracking } from "../src/hooks/use-shipment-tracking";

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: { getTracking: jest.fn() },
}));

const mockGetTracking = shipmentsClient.getTracking as jest.Mock;

// "_p~iF~ps|U_ulLnnqC_mqNvxq`@": ejemplo canónico de Google, decodifica a 3 puntos.
function tracking(state: "live" | "closed") {
  return {
    state,
    plannedRoute: { polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", distanceMeters: 1000, durationSeconds: 60 },
    trace: state === "live" ? [{ lat: 38.5, lng: -120.2, capturedAt: "2026-10-25T22:00:00Z" }] : [],
    pollIntervalSeconds: 15,
  };
}

let latest: ReturnType<typeof useShipmentTracking> | null = null;
function Harness() {
  latest = useShipmentTracking("shipment-1", { status: "in_transit" });
  return null;
}

async function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

// MOVO-346 (punto 12): la ruta y el recorrido del tramo del envío para emisor y receptor.
describe("useShipmentTracking", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetTracking.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it("decodifica la ruta y la traza, y repite cada pollIntervalSeconds mientras está live", async () => {
    mockGetTracking.mockResolvedValue(tracking("live"));

    await renderHarness();
    await waitFor(() => expect(latest?.planned).toHaveLength(3));
    expect(latest?.trace).toEqual([{ latitude: 38.5, longitude: -120.2 }]);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
    });
    expect(mockGetTracking).toHaveBeenCalledTimes(2);
  });

  it("con el seguimiento cerrado deja de pedir", async () => {
    mockGetTracking.mockResolvedValue(tracking("closed"));

    await renderHarness();
    await waitFor(() => expect(latest?.data?.state).toBe("closed"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });

    expect(mockGetTracking).toHaveBeenCalledTimes(1);
    expect(latest?.trace).toEqual([]);
  });
});
