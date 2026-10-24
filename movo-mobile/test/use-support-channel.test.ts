import { act, renderHook } from "@testing-library/react-native";
import { refreshTokens } from "../src/api/http-client";

process.env.EXPO_PUBLIC_API_URL = "http://localhost:3000";

jest.mock("../src/store/auth-store", () => {
  const state = { accessToken: "test-valid-token", status: "authenticated" };
  const mockFn: any = jest.fn((selector?: (s: any) => any) => (selector ? selector(state) : state));
  mockFn.getState = () => state;
  return { useAuthStore: mockFn, registerAuthHooks: jest.fn() };
});

jest.mock("../src/api/http-client", () => {
  const original = jest.requireActual("../src/api/http-client");
  return { ...original, getApiBaseUrl: jest.fn(() => "http://localhost:3000"), refreshTokens: jest.fn() };
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  options?: any;
  readyState = 0;
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;

  constructor(url: string, _protocols?: string | string[], options?: any) {
    this.url = url;
    this.options = options;
    MockWebSocket.instances.push(this);
  }

  close = jest.fn((code?: number) => {
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: "" });
  });

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  closeWith(code: number) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
}

(globalThis as any).WebSocket = MockWebSocket;

import { useSupportChannel } from "../src/hooks/use-support-channel";

const message = {
  id: "m1",
  conversationId: "c1",
  kind: "agent",
  authorName: "Lucía",
  body: "Hola",
  clientMessageId: "",
  moderated: false,
  deliveryStatus: null,
  attachments: [],
  createdAt: "2026-10-20T12:00:00.000Z",
};

describe("useSupportChannel (MOVO-324)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    (refreshTokens as jest.Mock).mockResolvedValue("new-token");
  });
  afterEach(() => jest.useRealTimers());

  it("conecta a /support/conversations/:id con el JWT en el handshake", async () => {
    const { result } = await renderHook(() => useSupportChannel("c1"));

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://localhost:3000/api/v1/support/conversations/c1");
    expect(ws.options).toEqual({ headers: { Authorization: "Bearer test-valid-token" } });
    expect(result.current.state).toBe("connecting");
    await act(async () => ws.open());
    expect(result.current.state).toBe("connected");
  });

  it("entrega mensajes, cambios de estado, tildes y el aviso de conexión", async () => {
    const onMessage = jest.fn();
    const onStatus = jest.fn();
    const onReceipt = jest.fn();
    const onConnected = jest.fn();
    await renderHook(() => useSupportChannel("c1", { onMessage, onStatus, onReceipt, onConnected }));
    const ws = MockWebSocket.instances[0];
    await act(async () => ws.open());

    await act(async () => ws.message({ type: "connected" }));
    await act(async () => ws.message({ type: "support_message", message }));
    await act(async () => ws.message({ type: "support_status", conversationId: "c1", status: "resolved" }));
    await act(async () => ws.message({ type: "support_receipt", conversationId: "c1", upTo: "2026-10-20T12:00:00.000Z" }));

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: "support_message", message });
    expect(onStatus).toHaveBeenCalledWith({ type: "support_status", conversationId: "c1", status: "resolved" });
    expect(onReceipt).toHaveBeenCalledTimes(1);
  });

  it("ignora un frame que no se puede parsear", async () => {
    const onMessage = jest.fn();
    await renderHook(() => useSupportChannel("c1", { onMessage }));
    const ws = MockWebSocket.instances[0];
    await act(async () => ws.open());
    await act(async () => ws.onmessage?.({ data: "{no es json" }));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("reconecta con backoff ante un cierre normal", async () => {
    const { result } = await renderHook(() => useSupportChannel("c1"));
    await act(async () => MockWebSocket.instances[0].open());

    await act(async () => MockWebSocket.instances[0].closeWith(1006));
    expect(result.current.state).toBe("reconnecting");
    await act(async () => jest.advanceTimersByTime(1000));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("4001 renueva el token y reconecta", async () => {
    await renderHook(() => useSupportChannel("c1"));
    await act(async () => MockWebSocket.instances[0].open());

    await act(async () => MockWebSocket.instances[0].closeWith(4001));
    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it.each([4003, 4004])("%i es terminal: no reconecta y avisa el cierre", async (code) => {
    const onTerminalClose = jest.fn();
    const { result } = await renderHook(() => useSupportChannel("c1", { onTerminalClose }));
    await act(async () => MockWebSocket.instances[0].open());

    await act(async () => MockWebSocket.instances[0].closeWith(code));
    await act(async () => jest.advanceTimersByTime(60_000));

    expect(result.current.state).toBe("closed");
    expect(onTerminalClose).toHaveBeenCalledWith(code);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("deshabilitado no abre el socket", async () => {
    await renderHook(() => useSupportChannel("c1", { enabled: false }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });
});
