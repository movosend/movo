import { renderHook, act } from "@testing-library/react-native";
import {
  calculateHaversineKm,
  formatTimeAgo,
  useLivePosition,
} from "../src/hooks/use-live-position";
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

  describe("Cálculos y utilidades", () => {
    it("calculateHaversineKm calcula la distancia correcta entre dos puntos", () => {
      const distance = calculateHaversineKm(-31.4201, -64.1888, -31.9140, -63.6820);
      expect(distance).toBeGreaterThan(70);
      expect(distance).toBeLessThan(80);
    });

    it("formatTimeAgo devuelve etiquetas correctas según el tiempo transcurrido", () => {
      const now = Date.now();
      expect(formatTimeAgo(new Date(now - 10_000).toISOString())).toBe("hace unos segundos");
      expect(formatTimeAgo(new Date(now - 70_000).toISOString())).toBe("hace 1 min");
      expect(formatTimeAgo(new Date(now - 150_000).toISOString())).toBe("hace 2 min");
      expect(formatTimeAgo(new Date(now - 3_700_000).toISOString())).toBe("hace 1 h");
      expect(formatTimeAgo(null)).toBe("Sin datos");
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
        useLivePosition("shipment-123", {
          destination: { lat: -31.9140, lng: -63.6820 },
        })
      );

      expect(result.current.position?.lat).toBe(-31.4201);
      expect(result.current.position?.lng).toBe(-64.1888);
      expect(result.current.trackingStatus).toBe("live");
      expect(result.current.isStale).toBe(false);
      expect(result.current.distanceKm).toBeGreaterThan(0);
      expect(result.current.estimatedArrivalMinutes).toBeGreaterThan(0);
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
        useLivePosition("shipment-123", {
          destination: { lat: -31.9140, lng: -63.6820 },
        })
      );

      expect(result.current.position?.lat).toBe(-31.4201);
      expect(result.current.isStale).toBe(true);
      expect(result.current.trackingStatus).toBe("stale");
    });

    it("marca el estado como closed cuando el canal reporta entrega finalizada", async () => {
      let statusCallback: ((status: string) => void) | undefined;

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
        useLivePosition("shipment-123", {
          destination: { lat: -31.9140, lng: -63.6820 },
        })
      );

      await act(async () => {
        statusCallback?.({
          type: "status",
          shipmentId: "shipment-123",
          status: "delivered",
        });
      });

      expect(result.current.isDelivered).toBe(true);
      expect(result.current.trackingStatus).toBe("closed");
    });
  });
});
