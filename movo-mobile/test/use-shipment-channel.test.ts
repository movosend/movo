import { renderHook, act, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { refreshTokens } from "../src/api/http-client";

process.env.EXPO_PUBLIC_API_URL = "http://localhost:3000";

// Mocks
jest.mock("../src/store/auth-store", () => {
  const state = {
    accessToken: "test-valid-token",
    status: "authenticated",
  };
  const mockFn: any = jest.fn((selector?: (s: any) => any) => {
    return selector ? selector(state) : state;
  });
  mockFn.getState = () => state;
  return {
    useAuthStore: mockFn,
    registerAuthHooks: jest.fn(),
  };
});

jest.mock("../src/api/http-client", () => {
  const original = jest.requireActual("../src/api/http-client");
  return {
    ...original,
    getApiBaseUrl: jest.fn(() => "http://localhost:3000"),
    refreshTokens: jest.fn(),
  };
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  protocols?: string | string[];
  options?: any;
  readyState: number = 0; // CONNECTING
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  constructor(url: string, protocols?: string | string[], options?: any) {
    this.url = url;
    this.protocols = protocols;
    this.options = options;
    MockWebSocket.instances.push(this);
  }

  send = jest.fn();
  close = jest.fn((code?: number, reason?: string) => {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "Normal closure" });
  });

  // Helper para simular eventos
  triggerOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  triggerMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  triggerClose(code = 1000, reason = "") {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code, reason });
  }

  triggerError(error: any) {
    this.onerror?.(error);
  }
}

// Reemplazar WebSocket global
(globalThis as any).WebSocket = MockWebSocket;

import { useShipmentChannel } from "../src/hooks/use-shipment-channel";

describe("useShipmentChannel (MOVO-204 WebSocket Hook)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    (refreshTokens as jest.Mock).mockResolvedValue("new-refreshed-token");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("conecta al WebSocket con la URL correcta y header Authorization Bearer", async () => {
    const { result, rerender } = await renderHook(() =>
      useShipmentChannel("shipment-123", { enabled: true })
    );

    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://localhost:3000/api/v1/shipments/shipment-123/track");
    expect(ws.options).toEqual({
      headers: {
        Authorization: "Bearer test-valid-token",
      },
    });
    expect(result.current.connectionState).toBe("connecting");

    // Simular conexión exitosa
    await act(async () => {
      ws.triggerOpen();
    });

    expect(result.current.connectionState).toBe("connected");
    expect(result.current.isTerminalClosed).toBe(false);
  });

  it("recibe mensajes de posición y llama al callback onPosition", async () => {
    const onPosition = jest.fn();
    await renderHook(() =>
      useShipmentChannel("shipment-123", { enabled: true, onPosition })
    );

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      ws.triggerOpen();
    });

    const samplePosition = {
      type: "position",
      lat: -31.4201,
      lng: -64.1888,
      heading: 90,
      speed: 12.5,
      capturedAt: "2026-09-27T12:00:00.000Z",
    };

    await act(async () => {
      ws.triggerMessage(samplePosition);
    });

    expect(onPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: -31.4201,
        lng: -64.1888,
        heading: 90,
        speed: 12.5,
      })
    );
  });

  it("maneja cierre con código 4001 renovando el token e intentando reconectar", async () => {
    await renderHook(() =>
      useShipmentChannel("shipment-123", { enabled: true })
    );

    const ws1 = MockWebSocket.instances[0];
    await act(async () => {
      ws1.triggerOpen();
    });

    // Simular expiración de token (cierre 4001)
    await act(async () => {
      ws1.triggerClose(4001, "Token expired");
    });

    expect(refreshTokens).toHaveBeenCalledTimes(1);

    // Avanzar el timer de delay tras refresh
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    // Debería haberse creado una segunda instancia de WebSocket
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("no reconecta si el código de cierre es 4009 (envío delivered / tracking finalizado)", async () => {
    const { result } = await renderHook(() =>
      useShipmentChannel("shipment-123", { enabled: true })
    );

    const ws = MockWebSocket.instances[0];
    await act(async () => {
      ws.triggerOpen();
    });

    // Código 4009 = TRACKING_STATUS_CLOSED_WS_CODE
    await act(async () => {
      ws.triggerClose(4009, "Shipment delivered. Channel closed.");
    });

    expect(result.current.isTerminalClosed).toBe(true);
    expect(result.current.connectionState).toBe("closed");

    // Avanzar timers: no debe intentar reconectar
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("al desmontar cierra el socket y no genera nuevas instancias tras avanzar timers", async () => {
    const { unmount } = await renderHook(() =>
      useShipmentChannel("shipment-123", { enabled: true })
    );

    expect(MockWebSocket.instances.length).toBe(1);

    await act(async () => {
      unmount();
    });

    // Avanzar timers varios segundos
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    // No debe haber nuevas instancias de socket creadas
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("reconnect() no dispara un loop infinito de sockets", async () => {
    const { result } = await renderHook(() =>
      useShipmentChannel("shipment-123", { enabled: true })
    );

    expect(MockWebSocket.instances.length).toBe(1);
    const ws1 = MockWebSocket.instances[0];

    await act(async () => {
      ws1.triggerOpen();
    });

    // Llamar reconnect()
    await act(async () => {
      result.current.reconnect();
    });

    // El primer socket se cerró y se creó el segundo
    expect(MockWebSocket.instances.length).toBe(2);
    const ws2 = MockWebSocket.instances[1];

    await act(async () => {
      ws2.triggerOpen();
    });

    // Avanzar timers 15 segundos
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });

    // No debe haberse generado ningún socket adicional en loop
    expect(MockWebSocket.instances.length).toBe(2);
  });
});
