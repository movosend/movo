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

import { useChatChannel } from "../src/hooks/use-chat-channel";

const message = {
  id: "m1",
  shipmentId: "s1",
  authorId: "diego",
  authorName: "Diego",
  body: "Estoy llegando",
  clientMessageId: "c1",
  moderated: false,
  hidden: false,
  deliveryStatus: null,
  createdAt: "2026-10-14T12:00:00.000Z",
};

describe("useChatChannel (MOVO-284)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    (refreshTokens as jest.Mock).mockResolvedValue("new-token");
  });
  afterEach(() => jest.useRealTimers());

  it("conecta a /shipments/:id/chat con el JWT en el handshake", async () => {
    const { result } = await renderHook(() => useChatChannel("s1"));

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://localhost:3000/api/v1/shipments/s1/chat");
    expect(ws.options).toEqual({ headers: { Authorization: "Bearer test-valid-token" } });
    expect(result.current.state).toBe("connecting");

    await act(async () => ws.open());
    expect(result.current.state).toBe("connected");
  });

  it("entrega los mensajes, los tildes y el aviso de conexión a sus callbacks", async () => {
    const onMessage = jest.fn();
    const onReceipt = jest.fn();
    const onConnected = jest.fn();
    await renderHook(() => useChatChannel("s1", { onMessage, onReceipt, onConnected }));
    const ws = MockWebSocket.instances[0];
    await act(async () => ws.open());

    await act(async () => ws.message({ type: "connected", shipmentId: "s1" }));
    await act(async () => ws.message({ type: "chat_message", message }));
    const receipt = { type: "chat_receipt", shipmentId: "s1", userId: "diego", status: "read", upTo: "2026-10-14T12:00:00.000Z" };
    await act(async () => ws.message(receipt));

    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(message);
    expect(onReceipt).toHaveBeenCalledWith(receipt);
  });

  it("ignora un frame que no se puede parsear", async () => {
    const onMessage = jest.fn();
    await renderHook(() => useChatChannel("s1", { onMessage }));
    const ws = MockWebSocket.instances[0];
    await act(async () => ws.open());

    await act(async () => ws.onmessage?.({ data: "no-es-json" }));
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("con un cierre 4001 renueva el token y reconecta", async () => {
    await renderHook(() => useChatChannel("s1"));
    const ws1 = MockWebSocket.instances[0];
    await act(async () => ws1.open());

    await act(async () => ws1.closeWith(4001));

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it.each([4003, 4004, 4009])("con el cierre terminal %s no vuelve a conectar", async (code) => {
    const { result } = await renderHook(() => useChatChannel("s1"));
    const ws = MockWebSocket.instances[0];
    await act(async () => ws.open());

    await act(async () => ws.closeWith(code));
    await act(async () => jest.advanceTimersByTime(60_000));

    expect(result.current.state).toBe("closed");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("ante una caída de red reconecta con backoff", async () => {
    const { result } = await renderHook(() => useChatChannel("s1"));
    const ws1 = MockWebSocket.instances[0];
    await act(async () => ws1.open());

    await act(async () => ws1.closeWith(1006));
    expect(result.current.state).toBe("reconnecting");
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(async () => jest.advanceTimersByTime(1000));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("deshabilitado no abre ningún socket", async () => {
    await renderHook(() => useChatChannel("s1", { enabled: false }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("al desmontar cierra el socket y no reconecta", async () => {
    const { unmount } = await renderHook(() => useChatChannel("s1"));
    expect(MockWebSocket.instances).toHaveLength(1);

    await act(async () => unmount());
    await act(async () => jest.advanceTimersByTime(60_000));

    expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
