import type { ChatMessage, ChatMessagesPage, ChatParticipant } from "@movo/shared/dist/types/chat";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useChatConversation } from "../src/hooks/use-chat-conversation";

const mockChatClient = {
  listMessages: jest.fn(),
  getParticipants: jest.fn(),
  sendMessage: jest.fn(),
  markRead: jest.fn(),
};
jest.mock("../src/api/chat-client", () => ({
  chatClient: {
    listMessages: (...args: unknown[]) => mockChatClient.listMessages(...args),
    getParticipants: (...args: unknown[]) => mockChatClient.getParticipants(...args),
    sendMessage: (...args: unknown[]) => mockChatClient.sendMessage(...args),
    markRead: (...args: unknown[]) => mockChatClient.markRead(...args),
  },
}));

let mockUuidCounter = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuidCounter}` }));

type ChannelOptions = { onMessage?: (m: ChatMessage) => void; onReceipt?: (e: unknown) => void; onConnected?: () => void };
let mockChannelOptions: ChannelOptions = {};
jest.mock("../src/hooks/use-chat-channel", () => ({
  useChatChannel: (_id: string, options: ChannelOptions) => {
    mockChannelOptions = options;
    return { state: "connected", isConnected: true };
  },
}));

jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => ({ data: { status: "in_transit" } }),
  useShipmentEvents: () => ({
    data: [{ id: "e1", shipmentId: "s1", fromStatus: null, toStatus: "in_transit", actorId: null, reason: null, createdAt: new Date().toISOString() }],
  }),
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { userId: "ana" }, status: "authenticated" }),
}));

const ana: ChatParticipant = { userId: "ana", role: "sender", firstName: "Ana", fullName: "Ana Molina", photoUrl: null };
const diego: ChatParticipant = { userId: "diego", role: "carrier", firstName: "Diego", fullName: "Diego Ramos", photoUrl: null };

function serverMessage(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: "srv-x",
    shipmentId: "s1",
    authorId: "diego",
    authorName: "Diego",
    body: "Hola",
    clientMessageId: "c-x",
    moderated: false,
    hidden: false,
    deliveryStatus: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function page(items: ChatMessage[], over: Partial<ChatMessagesPage> = {}): ChatMessagesPage {
  return { items, nextCursor: null, access: "open", archived: false, reportedByMe: false, ...over };
}

async function setup(
  first: ChatMessagesPage = page([serverMessage({ id: "srv-1", clientMessageId: "c-1", body: "Estoy llegando" })]),
  participants = [ana, diego],
  options: { focused?: boolean } = {},
) {
  mockChatClient.listMessages.mockResolvedValue(first);
  mockChatClient.getParticipants.mockResolvedValue({ participants });
  mockChatClient.markRead.mockResolvedValue({ readAt: new Date().toISOString() });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const rendered = await renderHook(() => useChatConversation("s1", options), { wrapper });
  return { client, ...rendered };
}

const messagesOf = (timeline: ReturnType<typeof useChatConversation>["timeline"]) =>
  timeline.flatMap((i) => (i.kind === "message" ? [i.message] : []));

describe("useChatConversation (MOVO-284)", () => {
  beforeEach(() => {
    mockUuidCounter = 0;
    mockChannelOptions = {};
  });
  afterEach(() => jest.clearAllMocks());

  it("carga el historial, los integrantes y marca la conversación como leída", async () => {
    const { result } = await setup();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(mockChatClient.markRead).toHaveBeenCalledWith("s1"));
    expect(messagesOf(result.current.timeline).map((m) => m.body)).toEqual(["Estoy llegando"]);
    expect(result.current.myRole).toBe("sender");
    expect(result.current.canWrite).toBe(true);
    // El historial del envío trae la tarjeta "Retiro confirmado" intercalada.
    expect(result.current.timeline.some((i) => i.kind === "event")).toBe(true);
  });

  it("un mensaje que llega dentro de la ventana de 2 s se marca leído al vencer (no se pierde)", async () => {
    const { result } = await setup();
    await waitFor(() => expect(mockChatClient.markRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      mockChannelOptions.onMessage?.(serverMessage({ id: "srv-9", clientMessageId: "c-9", body: "Estoy en la puerta" }));
    });
    // Dentro de la ventana todavía no sale otra llamada...
    expect(mockChatClient.markRead).toHaveBeenCalledTimes(1);
    // ...pero al vencer sale la pendiente.
    await waitFor(() => expect(mockChatClient.markRead.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4_000 });
  });

  it("con la pantalla fuera de foco no marca leído", async () => {
    const { result } = await setup(undefined, undefined, { focused: false });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      mockChannelOptions.onMessage?.(serverMessage({ id: "srv-9", clientMessageId: "c-9" }));
    });
    expect(mockChatClient.markRead).not.toHaveBeenCalled();
  });

  it("un mensaje enviado aparece enseguida y, confirmado, queda una sola vez", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolveSend!: (m: ChatMessage) => void;
    mockChatClient.sendMessage.mockReturnValue(new Promise<ChatMessage>((r) => (resolveSend = r)));

    await act(async () => {
      expect(result.current.send("  Te espero  ")).toBe(true);
    });
    const pending = messagesOf(result.current.timeline).find((m) => m.body === "Te espero");
    expect(pending).toMatchObject({ localState: "sending", clientMessageId: "uuid-1" });
    expect(mockChatClient.sendMessage).toHaveBeenCalledWith("s1", "Te espero", "uuid-1");

    await act(async () => {
      resolveSend(serverMessage({ id: "srv-2", authorId: "ana", clientMessageId: "uuid-1", body: "Te espero", deliveryStatus: "sent" }));
    });
    await waitFor(() => expect(messagesOf(result.current.timeline).filter((m) => m.body === "Te espero")).toHaveLength(1));
    expect(messagesOf(result.current.timeline).find((m) => m.body === "Te espero")?.localState).toBeUndefined();
  });

  it("si el envío falla queda marcado y al reintentar usa el mismo clientMessageId", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockChatClient.sendMessage.mockRejectedValueOnce(new Error("sin red"));
    await act(async () => {
      result.current.send("Hola");
    });
    await waitFor(() => expect(messagesOf(result.current.timeline).find((m) => m.body === "Hola")?.localState).toBe("failed"));

    mockChatClient.sendMessage.mockResolvedValueOnce(serverMessage({ id: "srv-3", authorId: "ana", clientMessageId: "uuid-1", body: "Hola" }));
    await act(async () => {
      result.current.retry("uuid-1");
    });

    await waitFor(() => expect(messagesOf(result.current.timeline).filter((m) => m.body === "Hola")).toHaveLength(1));
    expect(mockChatClient.sendMessage).toHaveBeenNthCalledWith(2, "s1", "Hola", "uuid-1");
    expect(mockUuidCounter).toBe(1);
  });

  it("descartar un mensaje fallido lo saca de la conversación", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockChatClient.sendMessage.mockRejectedValueOnce(new Error("sin red"));
    await act(async () => {
      result.current.send("Borrame");
    });
    await waitFor(() => expect(messagesOf(result.current.timeline).some((m) => m.body === "Borrame")).toBe(true));

    await act(async () => {
      result.current.discard("uuid-1");
    });
    expect(messagesOf(result.current.timeline).some((m) => m.body === "Borrame")).toBe(false);
  });

  it("cuando el filtro tapó palabras avisa al autor, y el aviso se puede cerrar", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockChatClient.sendMessage.mockResolvedValueOnce(
      serverMessage({ id: "srv-4", authorId: "ana", clientMessageId: "uuid-1", body: "sos un ******", moderated: true }),
    );
    await act(async () => {
      result.current.send("sos un idiota");
    });
    await waitFor(() => expect(result.current.moderationWarning).toBe(true));

    await act(async () => result.current.dismissModerationWarning());
    expect(result.current.moderationWarning).toBe(false);
  });

  it("un mensaje que llega por WebSocket se suma sin duplicarse si después llega por HTTP", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const incoming = serverMessage({ id: "srv-5", clientMessageId: "c-5", body: "Estoy en la puerta" });
    await act(async () => mockChannelOptions.onMessage?.(incoming));
    await act(async () => mockChannelOptions.onMessage?.(incoming));

    await waitFor(() => expect(messagesOf(result.current.timeline).some((m) => m.body === "Estoy en la puerta")).toBe(true));
    expect(messagesOf(result.current.timeline).filter((m) => m.body === "Estoy en la puerta")).toHaveLength(1);
  });

  it("un tilde nuevo (chat_receipt) vuelve a pedir el historial para actualizar los estados", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callsBefore = mockChatClient.listMessages.mock.calls.length;

    await act(async () => mockChannelOptions.onReceipt?.({ type: "chat_receipt", shipmentId: "s1", userId: "diego", status: "read", upTo: new Date().toISOString() }));

    await waitFor(() => expect(mockChatClient.listMessages.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("carga el historial más antiguo con el cursor al llegar al principio, sin repetir mensajes", async () => {
    const recent = { id: "srv-3", clientMessageId: "c-3", body: "Reciente", createdAt: "2026-10-14T12:00:00.000Z" };
    const old = { id: "srv-2", clientMessageId: "c-2", body: "Antiguo", createdAt: "2026-10-14T11:00:00.000Z" };
    const first = page([serverMessage(recent)], { nextCursor: "cursor-1" });
    const { result } = await setup(first);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasOlder).toBe(true);

    // La página siguiente repite un mensaje del borde: no tiene que duplicarse.
    mockChatClient.listMessages.mockResolvedValueOnce(page([serverMessage(recent), serverMessage(old)]));
    await act(async () => result.current.loadOlder());

    await waitFor(() => expect(messagesOf(result.current.timeline).map((m) => m.body)).toEqual(["Reciente", "Antiguo"]));
    expect(mockChatClient.listMessages).toHaveBeenLastCalledWith("s1", { cursor: "cursor-1", limit: 30 });
    await waitFor(() => expect(result.current.hasOlder).toBe(false));
  });

  it("no deja enviar un mensaje vacío ni uno de más de 1000 caracteres", async () => {
    const { result } = await setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.send("   ")).toBe(false);
    expect(result.current.send("a".repeat(1001))).toBe(false);
    expect(mockChatClient.sendMessage).not.toHaveBeenCalled();
  });

  it("en solo lectura no se puede escribir", async () => {
    const { result } = await setup(page([serverMessage({ id: "srv-1" })], { access: "read_only" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.canWrite).toBe(false);
    expect(result.current.send("Hola")).toBe(false);
    expect(mockChatClient.sendMessage).not.toHaveBeenCalled();
  });

  it("quien dejó de ser integrante (receptor original) lee pero no escribe", async () => {
    const { result } = await setup(page([serverMessage({ id: "srv-1" })], { access: "read_only" }), [diego]);
    await waitFor(() => expect(result.current.participants).toHaveLength(1));

    expect(result.current.isFormerReceiver).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it("sin mensajes se reconoce como conversación recién creada", async () => {
    const { result } = await setup(page([]));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isEmpty).toBe(true);
  });
});
