import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react-native";
import { Text, View } from "react-native";
import { paymentsClient } from "../src/api/payments-client";
import {
  type UseShipmentSettlementOptions,
  useShipmentSettlement,
} from "../src/hooks/use-shipment-settlement";

jest.mock("../src/api/payments-client", () => ({
  paymentsClient: {
    getShipmentSettlement: jest.fn(),
  },
}));

const mockGetShipmentSettlement =
  paymentsClient.getShipmentSettlement as jest.Mock;

function Harness({
  shipmentId,
  options,
  onState,
}: {
  shipmentId: string | undefined;
  options: UseShipmentSettlementOptions;
  onState: (query: ReturnType<typeof useShipmentSettlement>) => void;
}) {
  const query = useShipmentSettlement(shipmentId, options);
  onState(query);

  return (
    <View testID="harness">
      <Text testID="harness-data">{JSON.stringify(query.data)}</Text>
      <Text testID="harness-status">{query.status}</Text>
      <Text testID="harness-isError">{String(query.isError)}</Text>
      <Text testID="harness-timedOut">{String(query.isPollingTimedOut)}</Text>
    </View>
  );
}

async function renderHarness(
  shipmentId: string | undefined,
  options: UseShipmentSettlementOptions,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  let latestQuery: ReturnType<typeof useShipmentSettlement> | null = null;
  const onState = (q: ReturnType<typeof useShipmentSettlement>) => {
    latestQuery = q;
  };

  const rendered = await render(
    <QueryClientProvider client={queryClient}>
      <Harness
        shipmentId={shipmentId}
        options={options}
        onState={onState}
      />
    </QueryClientProvider>,
  );

  return {
    ...rendered,
    getQuery: () => latestQuery!,
  };
}

describe("useShipmentSettlement (MOVO-214)", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("no consulta si enabled es false", async () => {
    const { getQuery } = await renderHarness("s-1", { enabled: false });

    expect(mockGetShipmentSettlement).not.toHaveBeenCalled();
    expect(getQuery().data).toBeUndefined();
  });

  it("404 SETTLEMENT_NOT_FOUND se traduce a null en vez de error", async () => {
    mockGetShipmentSettlement.mockRejectedValue(
      new ApiError(404, "SETTLEMENT_NOT_FOUND", "Liquidación no iniciada"),
    );

    const { getByTestId, getQuery } = await renderHarness("s-1", {
      enabled: true,
    });

    await waitFor(() =>
      expect(getByTestId("harness-status")).toHaveTextContent("success"),
    );
    expect(getQuery().data).toBeNull();
    expect(getQuery().isError).toBe(false);
  });

  it("un error 500 deja isError en true y no queda en polling indefinido", async () => {
    mockGetShipmentSettlement.mockRejectedValue(
      new ApiError(500, "INTERNAL_ERROR", "Error interno"),
    );

    const { getByTestId, getQuery } = await renderHarness("s-1", {
      enabled: true,
      pollWhileProcessingMs: 1000,
    });

    await waitFor(() =>
      expect(getByTestId("harness-status")).toHaveTextContent("error"),
    );
    expect(getQuery().isError).toBe(true);
    expect(getQuery().data).toBeUndefined();
  });

  it("devuelve la liquidación acreditada", async () => {
    const credited: ShipmentSettlementResponse = {
      shipmentId: "s-1",
      role: "carrier",
      kind: "delivery",
      status: "credited",
      paidAmountArs: 13800,
      paidAt: "2026-10-14T19:42:00.000Z",
      mpFeeArs: 688.62,
      commissionArs: 1800,
      netAmountArs: 11311.38,
    };
    mockGetShipmentSettlement.mockResolvedValue(credited);

    const { getByTestId, getQuery } = await renderHarness("s-1", {
      enabled: true,
      pollWhileProcessingMs: 1000,
    });

    await waitFor(() =>
      expect(getByTestId("harness-status")).toHaveTextContent("success"),
    );
    expect(getQuery().data).toEqual(credited);
  });

  it("si se alcanza maxPollingDurationMs, activa isPollingTimedOut y refetch() lo resetea", async () => {
    mockGetShipmentSettlement.mockRejectedValue(
      new ApiError(404, "SETTLEMENT_NOT_FOUND", "Liquidación no iniciada"),
    );

    const { getByTestId, getQuery } = await renderHarness("s-1", {
      enabled: true,
      pollWhileProcessingMs: 1000,
      maxPollingDurationMs: 60,
    });

    await waitFor(() =>
      expect(getByTestId("harness-status")).toHaveTextContent("success"),
    );
    expect(getQuery().isPollingTimedOut).toBe(false);

    await waitFor(() =>
      expect(getByTestId("harness-timedOut")).toHaveTextContent("true"),
    );
    expect(getQuery().isPollingTimedOut).toBe(true);

    await act(async () => {
      await getQuery().refetch();
    });

    expect(getByTestId("harness-timedOut")).toHaveTextContent("false");
    expect(getQuery().isPollingTimedOut).toBe(false);
  });
});
