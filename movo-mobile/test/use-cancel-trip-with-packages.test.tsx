import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { TripAcceptedPackage } from "../src/api/trips-client";
import { useCancelTripWithPackages } from "../src/hooks/use-cancel-trip-with-packages";

const mockGetQuote = jest.fn();
const mockWithdraw = jest.fn();
const mockCancelTrip = jest.fn();

jest.mock("../src/api/shipments-client", () => ({
  shipmentsClient: {
    getCarrierWithdrawalQuote: (...a: unknown[]) => mockGetQuote(...a),
    withdrawCarrier: (...a: unknown[]) => mockWithdraw(...a),
  },
}));
jest.mock("../src/hooks/use-trips", () => ({
  useCancelTrip: () => ({ mutateAsync: (...a: unknown[]) => mockCancelTrip(...a) }),
}));

const pkg = (id: string, sender = "Julia Paz"): TripAcceptedPackage => ({
  shipmentId: id,
  status: ShipmentStatus.ASSIGNED,
  packageType: "standard_package",
  weightKg: 2,
  pickupAddress: "Nueva Córdoba, Córdoba",
  pickupLat: 0,
  pickupLng: 0,
  deliveryAddress: "Villa María",
  deliveryLat: 0,
  deliveryLng: 0,
  pickupDate: "2026-10-20",
  pickupTimeWindowStart: "07:00:00",
  pickupTimeWindowEnd: "09:00:00",
  agreedPriceArs: 10000,
  senderId: "sender-1",
  senderName: sender,
  senderPhotoUrl: null,
});

const quote = (penaltyArs: number) => ({ penaltyArs, reason: penaltyArs ? "late_cancellation" : "before_free_deadline", freeUntil: null });

async function setup(onStale?: () => void) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return await renderHook(() => useCancelTripWithPackages({ onStale }), { wrapper });
}

async function openAndQuote(result: Awaited<ReturnType<typeof setup>>["result"], packages: TripAcceptedPackage[]) {
  await act(async () => result.current.open(packages));
  await waitFor(() => expect(result.current.phase).not.toBe("quoting"));
}

describe("useCancelTripWithPackages (MOVO-314)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelTrip.mockResolvedValue({});
  });

  it("al abrir cotiza cada envío y suma la deuda", async () => {
    mockGetQuote.mockImplementation(async (id: string) => quote(id === "a" ? 2400 : 0));
    const { result } = await setup();

    await openAndQuote(result, [pkg("a"), pkg("b")]);

    expect(result.current.phase).toBe("ready");
    expect(result.current.rows.map((r) => r.penaltyArs)).toEqual([2400, 0]);
    expect(result.current.totalDebtArs).toBe(2400);
  });

  it("si una cotización falla queda en quoteError y el reintento cotiza de nuevo", async () => {
    mockGetQuote.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x")).mockResolvedValue(quote(0));
    const { result } = await setup();

    await openAndQuote(result, [pkg("a")]);
    expect(result.current.phase).toBe("quoteError");

    await act(async () => result.current.retryQuotes());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
  });

  it("confirmar baja de cada envío con su penalidad y después cancela el viaje", async () => {
    mockGetQuote.mockImplementation(async (id: string) => quote(id === "a" ? 2400 : 0));
    mockWithdraw.mockResolvedValue({});
    const { result } = await setup();
    await openAndQuote(result, [pkg("a"), pkg("b")]);

    let summary: unknown;
    await act(async () => {
      summary = await result.current.run("trip-1", true);
    });

    expect(mockWithdraw.mock.calls).toEqual([
      ["a", { expectedPenaltyArs: 2400 }],
      ["b", { expectedPenaltyArs: 0 }],
    ]);
    expect(mockCancelTrip).toHaveBeenCalledWith({ id: "trip-1", stopRecurrence: true });
    expect(summary).toEqual({ withdrawnCount: 2, debtArs: 2400 });
    expect(mockWithdraw.mock.invocationCallOrder[1]).toBeLessThan(mockCancelTrip.mock.invocationCallOrder[0]);
  });

  it("fallo a mitad: no cancela el viaje y el reintento sigue con los envíos que faltan", async () => {
    mockGetQuote.mockResolvedValue(quote(0));
    mockWithdraw.mockResolvedValueOnce({}).mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x")).mockResolvedValue({});
    const { result } = await setup();
    await openAndQuote(result, [pkg("a"), pkg("b")]);

    await act(async () => {
      expect(await result.current.run("trip-1", false)).toBeNull();
    });
    expect(mockCancelTrip).not.toHaveBeenCalled();
    expect(result.current.rows.map((r) => r.done)).toEqual([true, false]);
    expect(result.current.errorMessage).toMatch(/Los envíos que faltan siguen asignados/);

    await act(async () => {
      expect(await result.current.run("trip-1", false)).toEqual({ withdrawnCount: 2, debtArs: 0 });
    });
    expect(mockWithdraw.mock.calls.map((c) => c[0])).toEqual(["a", "b", "b"]);
    expect(mockCancelTrip).toHaveBeenCalledTimes(1);
  });

  it("409 de monto: re-cotiza solo ese envío, avisa y no sigue", async () => {
    mockGetQuote.mockResolvedValueOnce(quote(0)).mockResolvedValueOnce(quote(2450));
    mockWithdraw.mockRejectedValueOnce(new ApiError(409, "CANCELLATION_PENALTY_MISMATCH", "x", { penaltyArs: 2450 }));
    const { result } = await setup();
    await openAndQuote(result, [pkg("a")]);

    await act(async () => {
      expect(await result.current.run("trip-1", false)).toBeNull();
    });

    expect(result.current.rows[0].penaltyArs).toBe(2450);
    expect(result.current.mismatchNotice).not.toBeNull();
    expect(mockCancelTrip).not.toHaveBeenCalled();
  });

  it("409 de estado: avisa que cambió y pide refrescar el detalle", async () => {
    mockGetQuote.mockResolvedValue(quote(0));
    mockWithdraw.mockRejectedValueOnce(new ApiError(409, "SHIPMENT_INVALID_TRANSITION", "x"));
    const onStale = jest.fn();
    const { result } = await setup(onStale);
    await openAndQuote(result, [pkg("a")]);

    await act(async () => {
      expect(await result.current.run("trip-1", false)).toBeNull();
    });

    expect(onStale).toHaveBeenCalledTimes(1);
    expect(result.current.errorMessage).toMatch(/cambió de estado/);
  });

  it("si todos se bajaron pero falla el cancel del viaje, el reintento solo cancela el viaje", async () => {
    mockGetQuote.mockResolvedValue(quote(0));
    mockWithdraw.mockResolvedValue({});
    mockCancelTrip.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x")).mockResolvedValueOnce({});
    const { result } = await setup();
    await openAndQuote(result, [pkg("a")]);

    await act(async () => {
      expect(await result.current.run("trip-1", false)).toBeNull();
    });
    await act(async () => {
      expect(await result.current.run("trip-1", false)).toEqual({ withdrawnCount: 1, debtArs: 0 });
    });

    expect(mockWithdraw).toHaveBeenCalledTimes(1);
    expect(mockCancelTrip).toHaveBeenCalledTimes(2);
  });
});
