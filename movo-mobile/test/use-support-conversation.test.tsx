import type { SupportRealtimeEvent, SupportUserFacingMessage, SupportMessagesPage } from "@movo/shared/dist/types/support";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useSupportConversation } from "../src/hooks/use-support-conversation";

const mockSupportClient = {
  listMessages: jest.fn(),
  sendMessage: jest.fn(),
  markRead: jest.fn(),
};
jest.mock("../src/api/support-client", () => ({
  isSupportMock: () => false,
  supportClient: {
    listMessages: (...args: unknown[]) => mockSupportClient.listMessages(...args),
    sendMessage: (...args: unknown[]) => mockSupportClient.sendMessage(...args),
    markRead: (...args: unknown[]) => mockSupportClient.markRead(...args),
  },
}));

let mockUuidCounter = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuidCounter}` }));

const mockDismiss = jest.fn();
jest.mock("../src/lib/dismiss-support-notifications", () => ({
  dismissSupportNotifications: (...args: unknown[]) => mockDismiss(...args),
}));

type ChannelOptions = {
  enabled?: boolean;
  onMessage?: (e: Extract<SupportRealtimeEvent, { type: "support_message" }>) => void;
  onStatus?: (e: Extract<SupportRealtimeEvent, { type: "support_status" }>) => void;
  onReceipt?: () => void;
  onConnected?: () => void;
  onTerminalClose?: (code: number) => void;
};
let mockChannelOptions: ChannelOptions = {};
jest.mock("../src/hooks/use-support-channel", () => ({
  useSupportChannel: (_id: string, options: ChannelOptions) => {
    mockChannelOptions = options;
    return { state: "connected", isConnected: true };
  },
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { userId: "julia" }, status: "authenticated" }),
}));

function msg(over: Partial<SupportUserFacingMessage>): SupportUserFacingMessage {
  return {
    id: "srv-x",
    conversationId: "c1",
    kind: "agent",
    authorName: "Lucía",
    body: "Hola",
    clientMessageId: "",
    moderated: false,
    deliveryStatus: null,
    attachments: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function page(items: SupportUserFacingMessage[], status: "open" | "awaiting_user" | "resolved" = "open"): SupportMessagesPage {
  return {
    items,
    nextCursor: null,
    conversation: { id: "c1", code: "SOP-1042", topic: "shipment", status, shipment: null, lastMessage: null, unreadCount: 0, lastActivityAt: new Date().toISOString() },
  };
}

async function setup(first: SupportMessagesPage = page([msg({ id: "srv-1", body: "Hola Julia" })]), options: { focused?: boolean } = {}) {
  mockSupportClient.listMessages.mockResolvedValue(first);
  mockSupportClient.markRead.mockResolvedValue({ readAt: new Date().toISOString() });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const rendered = await renderHook(() => useSupportConversation("c1", options), { wrapper });
  return { client, ...rendered };
}

const messagesOf = (timeline: ReturnType<typeof useSupportConversation>["timeline"]) =>
  timeline.flatMap((i) => (i.kind === "message" ? [i.message] : []));

describe("useSupportConversation (MOVO-324)", () => {
  beforeEach(() => {
    mockUuidCounter = 0;
    mockChannelOptions = {};
  });
  afterEach(() => jest.clearAllMocks());

  it("carga el historial, marca la consulta como leída y descarta sus notificaciones", async () => {
    const { result } = await setup();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(mockSupportClient.markRead).toHaveBeenCalledWith("c1"));
    expect(messagesOf(result.current.timeline).map((m) => m.body)).toEqual(["Hola Julia"]);
    expect(result.current.conversation?.code).toBe("SOP-1042");
    expect(mockDismiss).toHaveBeenCalledWith("c1");
  });

  it("sin la pantalla al frente no marca leído ni descarta notificaciones", async () => {
    await setup(undefined, { focused: false });
    await waitFor(() => expect(mockSupportClient.listMessages).toHaveBeenCalled());
    expect(mockSupportClient.markRead).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it("los eventos del sistema salen como tarjetas aparte y una nota interna que llegara no se dibuja", async () => {
    const note = { ...msg({ id: "n1", body: "NOTA SECRETA" }), kind: "internal_note" } as unknown as SupportUserFacingMessage;
    const { result } = await setup(
      page([msg({ id: "s1", kind: "system", authorName: null, body: "Lucía Ferreyra tomó la conversación" }), note, msg({ id: "a1", body: "Hola" })]),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.timeline.some((i) => i.kind === "event")).toBe(true);
    expect(messagesOf(result.current.timeline).map((m) => m.body)).toEqual(["Hola"]);
  });

  it("envía de forma optimista y al confirmarse deja un solo mensaje", async () => {
    let resolveSend: (m: SupportUserFacingMessage) => void = () => undefined;
    mockSupportClient.sendMessage.mockImplementation(() => new Promise((resolve) => (resolveSend = resolve)));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = result.current.send("  Sí, hay portero  ");
    });
    expect(ok).toBe(true);
    expect(mockSupportClient.sendMessage).toHaveBeenCalledWith("c1", { body: "Sí, hay portero", clientMessageId: "uuid-1" });
    expect(messagesOf(result.current.timeline).find((m) => m.clientMessageId === "uuid-1")?.localState).toBe("sending");

    await act(async () => {
      resolveSend(msg({ id: "srv-2", kind: "user", authorName: null, body: "Sí, hay portero", clientMessageId: "uuid-1", deliveryStatus: "sent" }));
    });
    await waitFor(() => expect(messagesOf(result.current.timeline).filter((m) => m.clientMessageId === "uuid-1")).toHaveLength(1));
    expect(messagesOf(result.current.timeline).find((m) => m.clientMessageId === "uuid-1")?.localState).toBeUndefined();
  });

  it("si falla, queda 'No se envió' y el reintento usa el mismo clientMessageId", async () => {
    mockSupportClient.sendMessage.mockRejectedValueOnce(new Error("red"));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.send("Hola");
    });
    await waitFor(() => expect(messagesOf(result.current.timeline).find((m) => m.clientMessageId === "uuid-1")?.localState).toBe("failed"));
    expect(result.current.sendError).toBeTruthy();

    mockSupportClient.sendMessage.mockResolvedValueOnce(msg({ id: "srv-3", kind: "user", authorName: null, body: "Hola", clientMessageId: "uuid-1" }));
    await act(async () => {
      result.current.retry("uuid-1");
    });
    expect(mockSupportClient.sendMessage).toHaveBeenLastCalledWith("c1", { body: "Hola", clientMessageId: "uuid-1" });
    await waitFor(() => expect(result.current.sendError).toBeNull());
  });

  it("si falla el primero de dos envíos simultáneos, permite reintentarlo", async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    mockSupportClient.sendMessage
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(msg({ id: "srv-2", kind: "user", authorName: null, body: "Segundo", clientMessageId: "uuid-2" }));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.send("Primero");
      result.current.send("Segundo");
    });
    await act(async () => rejectFirst(new Error("red")));

    await waitFor(() => expect(messagesOf(result.current.timeline).find((m) => m.clientMessageId === "uuid-1")?.localState).toBe("failed"));
    expect(result.current.sendError).toBeTruthy();
  });

  it("descartar quita el mensaje que no salió", async () => {
    mockSupportClient.sendMessage.mockRejectedValueOnce(new Error("red"));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      result.current.send("Hola");
    });
    await waitFor(() => expect(messagesOf(result.current.timeline).some((m) => m.localState === "failed")).toBe(true));

    await act(async () => result.current.discard("uuid-1"));
    expect(messagesOf(result.current.timeline).some((m) => m.clientMessageId === "uuid-1")).toBe(false);
  });

  it("manda solo fotos (sin texto) con sus attachmentIds", async () => {
    mockSupportClient.sendMessage.mockResolvedValue(msg({ id: "srv-4", kind: "user", authorName: null, body: "", clientMessageId: "uuid-1" }));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = false;
    await act(async () => {
      ok = result.current.send("", [{ attachmentId: "att-1", localUri: "file:///a.jpg" }]);
    });
    expect(ok).toBe(true);
    expect(mockSupportClient.sendMessage).toHaveBeenCalledWith("c1", { body: "", clientMessageId: "uuid-1", attachmentIds: ["att-1"] });
  });

  it("no envía vacío ni pasado del máximo", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.send("   ")).toBe(false);
    expect(result.current.send("x".repeat(2001))).toBe(false);
    expect(mockSupportClient.sendMessage).not.toHaveBeenCalled();
  });

  it("una consulta resuelta se reabre al escribir: el estado pasa a 'open'", async () => {
    mockSupportClient.sendMessage.mockResolvedValue(msg({ id: "srv-5", kind: "user", authorName: null, body: "Sigue", clientMessageId: "uuid-1" }));
    const { result } = await setup(page([msg({ id: "a1" })], "resolved"));
    await waitFor(() => expect(result.current.resolved).toBe(true));

    await act(async () => {
      result.current.send("Sigue");
    });
    await waitFor(() => expect(result.current.resolved).toBe(false));
    expect(result.current.conversation?.status).toBe("open");
  });

  it("un mensaje moderado muestra el aviso", async () => {
    mockSupportClient.sendMessage.mockResolvedValue(msg({ id: "srv-6", kind: "user", authorName: null, body: "es una ******", moderated: true, clientMessageId: "uuid-1" }));
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.send("es una mierda");
    });
    await waitFor(() => expect(result.current.moderationWarning).toBe(true));
    await act(async () => result.current.dismissModerationWarning());
    expect(result.current.moderationWarning).toBe(false);
  });

  it("un mensaje del equipo que llega por el WebSocket se suma y se marca leído", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(mockSupportClient.markRead).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockChannelOptions.onMessage?.({ type: "support_message", message: msg({ id: "srv-9", body: "¿Podés mandar una foto?" }) });
    });
    await waitFor(() => expect(messagesOf(result.current.timeline).map((m) => m.body)).toContain("¿Podés mandar una foto?"));
    await waitFor(() => expect(mockSupportClient.markRead.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4_000 });
  });

  it("ignora una nota interna que llegue por WebSocket incluso en el caché de la lista", async () => {
    const { client, result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const list = { items: [{ ...page([]).conversation, lastMessage: null }] };
    client.setQueryData(["support", "list"], list);
    const note = { ...msg({ id: "note-1", body: "NOTA SECRETA" }), kind: "note" } as unknown as SupportUserFacingMessage;

    await act(async () => mockChannelOptions.onMessage?.({ type: "support_message", message: note }));

    expect(client.getQueryData(["support", "list"])).toEqual(list);
    expect(messagesOf(result.current.timeline).some((message) => message.body === "NOTA SECRETA")).toBe(false);
  });

  it("un cambio de estado por el WebSocket actualiza la consulta", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      mockChannelOptions.onStatus?.({ type: "support_status", conversationId: "c1", status: "resolved" });
    });
    await waitFor(() => expect(result.current.resolved).toBe(true));
  });

  it("4004 marca la consulta como no disponible; otros cierres no", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => mockChannelOptions.onTerminalClose?.(4003));
    expect(result.current.unavailable).toBe(false);
    await act(async () => mockChannelOptions.onTerminalClose?.(4004));
    expect(result.current.unavailable).toBe(true);
  });

  it("al reconectar el canal vuelve a pedir la primera página", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const calls = mockSupportClient.listMessages.mock.calls.length;

    await act(async () => mockChannelOptions.onConnected?.());
    await waitFor(() => expect(mockSupportClient.listMessages.mock.calls.length).toBeGreaterThan(calls));
  });

  it("con el mock activo no se abre el canal", async () => {
    // El flag se lee en cada render: `enabled` queda en falso cuando `isSupportMock()` es verdadero.
    const clientModule = jest.requireMock("../src/api/support-client");
    const original = clientModule.isSupportMock;
    clientModule.isSupportMock = () => true;
    await setup();
    expect(mockChannelOptions.enabled).toBe(false);
    clientModule.isSupportMock = original;
  });
});
