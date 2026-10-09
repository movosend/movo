import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("../src/api/trips-client", () => ({
  ...jest.requireActual("../src/api/trips-client"),
  tripsClient: {
    create: jest.fn(),
    start: jest.fn(),
  },
}));

const mockMarkTripAsSeen = jest.fn().mockResolvedValue(undefined);
jest.mock("../src/lib/seen-trips", () => ({
  markTripAsSeen: (id: string) => mockMarkTripAsSeen(id),
}));

import { TripStatus, tripsClient } from "../src/api/trips-client";
import { useCreateTrip, useStartTrip } from "../src/hooks/use-trips";
import type { CreateTripInput, Trip } from "../src/api/trips-client";

const mockCreate = tripsClient.create as jest.Mock;
const mockStart = tripsClient.start as jest.Mock;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const FAKE_INPUT: CreateTripInput = {
  originAddress: "Av. Colón 1234, Córdoba",
  originLat: -31.4201,
  originLng: -64.1888,
  destinationAddress: "Av. San Martín 100, Villa María",
  destinationLat: -32.4104,
  destinationLng: -63.2404,
  departureAt: "2026-09-10T12:00:00.000Z",
  vehicleType: "Auto",
};

const FAKE_TRIP: Trip = {
  id: "trip-nuevo",
  carrierId: "carrier-1",
  ...FAKE_INPUT,
  status: TripStatus.DECLARED,
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
  cancelledAt: null,
};

describe("useCreateTrip (MOVO-236)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marca el viaje recién creado como 'visto' -- evita que 'Mis viajes' lo reporte también como auto-creado", async () => {
    mockCreate.mockResolvedValue(FAKE_TRIP);
    const { result } = await renderHook(() => useCreateTrip(), { wrapper });

    await act(async () => {
      result.current.mutate(FAKE_INPUT);
    });

    await waitFor(() => expect(mockMarkTripAsSeen).toHaveBeenCalledWith("trip-nuevo"));
  });
});

describe("useStartTrip (MOVO-252)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("inicia el viaje llamando a tripsClient.start con el id correspondiente", async () => {
    const startedTrip: Trip = { ...FAKE_TRIP, id: "trip-1", status: TripStatus.ACTIVE };
    mockStart.mockResolvedValue(startedTrip);

    const { result } = await renderHook(() => useStartTrip(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("trip-1");
    });

    expect(mockStart).toHaveBeenCalledWith("trip-1");
  });
});
