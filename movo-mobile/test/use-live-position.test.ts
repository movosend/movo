import { renderHook, act } from "@testing-library/react-native";
import { useLivePosition } from "../src/hooks/use-live-position";
import { useShipmentChannel } from "../src/hooks/use-shipment-channel";

const mockUseQuery = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

jest.mock("../src/hooks/use-shipment-channel", () => ({
  useShipmentChannel: jest.fn(),
}));

describe("useLivePosition (MOVO-204 Live Tracking Hook)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useShipmentChannel as jest.Mock).mockReturnValue({
      connectionState: "connected",
      isTerminalClosed: false,
      reconnect: jest.fn(),
    });
  });

  describe("Comportamiento del hook", () => {
    it("inicializa con la posición obtenida por HTTP", async () => {
      const mockInitialPosition = {
        lat: -31.4201,
        lng: -64.1888,
        accuracyM: 10,
        capturedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      };

      mockUseQuery.mockReturnValue({
        data: mockInitialPosition,
        isLoading: false,
        refetch: jest.fn(),
      });

      const { result } = await renderHook(() =>
        useLivePosition("shipment-123")
      );

      expect(result.current.position?.lat).toBe(-31.4201);
      expect(result.current.position?.lng).toBe(-64.1888);
      expect(result.current.isStale).toBe(false);
    });

    it("marca la posición como stale si la captura tiene más de 120 segundos", async () => {
      const oldTimestamp = new Date(Date.now() - 130_000).toISOString();
      const mockInitialPosition = {
        lat: -31.4201,
        lng: -64.1888,
        accuracyM: 10,
        capturedAt: oldTimestamp,
        recordedAt: oldTimestamp,
      };

      mockUseQuery.mockReturnValue({
        data: mockInitialPosition,
        isLoading: false,
        refetch: jest.fn(),
      });

      const { result } = await renderHook(() =>
        useLivePosition("shipment-123")
      );

      expect(result.current.position?.lat).toBe(-31.4201);
      expect(result.current.isStale).toBe(true);
    });

    it("marca el estado como closed cuando el canal reporta entrega finalizada", async () => {
      let statusCallback: ((event: any) => void) | undefined;

      mockUseQuery.mockReturnValue({
        data: null,
        isLoading: false,
        refetch: jest.fn(),
      });

      (useShipmentChannel as jest.Mock).mockImplementation((_id, opts) => {
        statusCallback = opts?.onStatus;
        return {
          connectionState: "connected",
          isTerminalClosed: false,
          reconnect: jest.fn(),
        };
      });

      const { result } = await renderHook(() =>
        useLivePosition("shipment-123")
      );

      await act(async () => {
        statusCallback?.({
          type: "status",
          shipmentId: "shipment-123",
          status: "delivered",
        });
      });

      expect(result.current.isDelivered).toBe(true);
    });

    it("no tiene posición cuando el canal está conectado pero no hay posición registrada (AC6)", async () => {
      mockUseQuery.mockReturnValue({
        data: null,
        isLoading: false,
        refetch: jest.fn(),
      });

      const { result } = await renderHook(() =>
        useLivePosition("shipment-123")
      );

      expect(result.current.position).toBeNull();
    });

    it("transiciona a stale con fake timers al pasar 121 segundos sin actualizaciones", async () => {
      jest.useFakeTimers();
      const mockInitialPosition = {
        lat: -31.4201,
        lng: -64.1888,
        accuracyM: 10,
        capturedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      };

      mockUseQuery.mockReturnValue({
        data: mockInitialPosition,
        isLoading: false,
        refetch: jest.fn(),
      });

      const { result } = await renderHook(() =>
        useLivePosition("shipment-123")
      );

      expect(result.current.isStale).toBe(false);

      // Avanzar 121 segundos
      await act(async () => {
        jest.advanceTimersByTime(121_000);
      });

      expect(result.current.isStale).toBe(true);
      jest.useRealTimers();
    });
  });
});
