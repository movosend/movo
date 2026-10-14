import type { ChatParticipant } from "@movo/shared/dist/types/chat";
import { CHAT_MODERATION_WARNING } from "@movo/shared/dist/types/chat";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import ShipmentChatScreen from "../app/(app)/shipments/[id]/chat";
import type { ChatTimelineItem, LocalChatMessage } from "../src/lib/chat-format";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: "s1" }),
  useIsFocused: () => true,
}));

const mockChat = jest.fn();
jest.mock("../src/hooks/use-chat-conversation", () => ({ useChatConversation: () => mockChat() }));

const mockReport = jest.fn();
const mockToggleBlock = jest.fn();
jest.mock("../src/hooks/use-chat", () => ({
  useReportChat: () => ({ mutate: mockReport, isPending: false, isSuccess: false }),
  useChatBlockToggle: () => ({ mutate: mockToggleBlock, isPending: false }),
}));

const mockBlocked = jest.fn();
jest.mock("../src/hooks/use-moderation", () => ({ useBlockedUsers: () => mockBlocked() }));

const ana: ChatParticipant = { userId: "ana", role: "sender", firstName: "Ana", fullName: "Ana Molina", photoUrl: null };
const diego: ChatParticipant = { userId: "diego", role: "carrier", firstName: "Diego", fullName: "Diego Ramos", photoUrl: null };
const luis: ChatParticipant = { userId: "luis", role: "receiver", firstName: "Luis", fullName: "Luis Paz", photoUrl: null };

function message(over: Partial<LocalChatMessage> & { authorId: string }): LocalChatMessage {
  return {
    id: over.id ?? `id-${over.clientMessageId ?? over.authorId}`,
    shipmentId: "s1",
    authorName: null,
    body: "Hola",
    clientMessageId: over.clientMessageId ?? `c-${over.authorId}`,
    moderated: false,
    hidden: false,
    deliveryStatus: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function item(m: LocalChatMessage, mine: boolean, extra: Partial<Extract<ChatTimelineItem, { kind: "message" }>> = {}): ChatTimelineItem {
  return { kind: "message", key: `message-${m.clientMessageId}`, message: m, mine, showName: !mine, showAvatar: !mine, groupStart: true, ...extra };
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    meId: "ana",
    myRole: "sender",
    shipment: { status: "in_transit" },
    participants: [ana, diego, luis],
    timeline: [] as ChatTimelineItem[],
    access: "open",
    archived: false,
    reportedByMe: false,
    isFormerReceiver: false,
    canWrite: true,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    hasOlder: false,
    loadOlder: jest.fn(),
    isLoadingOlder: false,
    isEmpty: false,
    send: jest.fn(() => true),
    retry: jest.fn(),
    discard: jest.fn(),
    sendError: null,
    moderationWarning: false,
    dismissModerationWarning: jest.fn(),
    channelState: "connected",
    ...overrides,
  };
}

describe("ShipmentChatScreen (MOVO-284)", () => {
  beforeEach(() => mockBlocked.mockReturnValue({ data: [] }));
  afterEach(() => jest.clearAllMocks());

  it("el encabezado nombra a los tres integrantes", async () => {
    mockChat.mockReturnValue(state({ isEmpty: true }));
    const { getByText, getByTestId } = await render(<ShipmentChatScreen />);

    expect(getByText("Chat del envío")).toBeTruthy();
    expect(getByTestId("chat-header-names")).toHaveTextContent("Ana, Diego y Luis");
  });

  it("sin mensajes muestra el estado de recién creado con la tarjeta del envío", async () => {
    const card = { kind: "event" as const, key: "event-e1", card: { id: "e1", text: "Diego aceptó el envío", live: false, createdAt: new Date().toISOString() } };
    mockChat.mockReturnValue(state({ isEmpty: true, timeline: [card] }));
    const { getByTestId, getByText } = await render(<ShipmentChatScreen />);

    expect(getByTestId("chat-empty")).toBeTruthy();
    expect(getByText("Diego aceptó el envío")).toBeTruthy();
    expect(getByText("Coordinen acá")).toBeTruthy();
    expect(getByText(/Se cierra 24 h después de finalizado el envío/)).toBeTruthy();
  });

  it("sin mensajes, las tarjetas del envío se muestran del más viejo al más nuevo", async () => {
    const at = (h: number) => new Date(2026, 8, 14, h).toISOString();
    const event = (id: string, text: string, h: number) => ({ kind: "event" as const, key: `event-${id}`, card: { id, text, live: false, createdAt: at(h) } });
    // `timeline` llega del más nuevo al más viejo.
    mockChat.mockReturnValue(
      state({ isEmpty: true, timeline: [event("e3", "Entrega confirmada", 12), event("e2", "Retiro confirmado", 11), event("e1", "Envío aceptado", 10)] }),
    );
    const { getAllByTestId } = await render(<ShipmentChatScreen />);

    expect(getAllByTestId(/^chat-event-/).map((node) => node.props.testID)).toEqual(["chat-event-e1", "chat-event-e2", "chat-event-e3"]);
  });

  it("muestra nombre y rol en la burbuja ajena y los tildes con su estado al tocarlos", async () => {
    const theirs = message({ authorId: "diego", clientMessageId: "c-d", body: "Estoy llegando" });
    const mine = message({ authorId: "ana", clientMessageId: "c-a", body: "Te espero", deliveryStatus: "read" });
    mockChat.mockReturnValue(state({ timeline: [item(mine, true), item(theirs, false)] }));
    const { getByText, getByTestId, queryByTestId } = await render(<ShipmentChatScreen />);

    expect(getByText("Diego R. · Transportista")).toBeTruthy();
    expect(getByText("Estoy llegando")).toBeTruthy();
    // El tilde se toca para ver el estado (como el prototipo).
    expect(queryByTestId("chat-message-c-a-status")).toBeNull();
    await fireEvent.press(getByTestId("chat-message-c-a-ticks"));
    expect(getByTestId("chat-message-c-a-status")).toHaveTextContent("Leído por todos");
  });

  it("un mensaje de un usuario bloqueado no muestra su contenido", async () => {
    const hidden = message({ authorId: "luis", clientMessageId: "c-h", body: "", hidden: true });
    mockChat.mockReturnValue(state({ timeline: [item(hidden, false)] }));
    const { getByText } = await render(<ShipmentChatScreen />);

    expect(getByText("Mensaje de un usuario bloqueado")).toBeTruthy();
  });

  it("dibuja la tarjeta del envío y el separador de día", async () => {
    mockChat.mockReturnValue(
      state({
        timeline: [
          { kind: "event", key: "event-e1", card: { id: "e1", text: "Retiro confirmado, en camino", live: true, createdAt: new Date().toISOString() } },
          { kind: "day", key: "day-1", label: "Hoy" },
        ],
      }),
    );
    const { getByText } = await render(<ShipmentChatScreen />);

    expect(getByText("Retiro confirmado, en camino")).toBeTruthy();
    expect(getByText("Hoy")).toBeTruthy();
  });

  it("las respuestas rápidas dependen del rol y enviar una la manda directo", async () => {
    const send = jest.fn(() => true);
    mockChat.mockReturnValue(state({ myRole: "carrier", meId: "diego", timeline: [item(message({ authorId: "ana" }), false)], send }));
    const { getByTestId, queryByText } = await render(<ShipmentChatScreen />);

    expect(queryByText("Está listo para retirar")).toBeNull();
    await fireEvent.press(getByTestId("chat-quick-replies-Llego en 10 min"));
    expect(send).toHaveBeenCalledWith("Llego en 10 min");
  });

  it("escribir y tocar enviar manda el mensaje", async () => {
    const send = jest.fn(() => true);
    mockChat.mockReturnValue(state({ timeline: [item(message({ authorId: "diego" }), false)], send }));
    const { getByTestId } = await render(<ShipmentChatScreen />);

    await fireEvent.changeText(getByTestId("chat-composer-input"), "  Gracias  ");
    await fireEvent.press(getByTestId("chat-composer-send"));
    expect(send).toHaveBeenCalledWith("Gracias");
  });

  it("en solo lectura reemplaza el campo por el candado y oculta las respuestas rápidas", async () => {
    mockChat.mockReturnValue(state({ canWrite: false, access: "read_only", shipment: { status: "delivered" }, timeline: [item(message({ authorId: "diego" }), false)] }));
    const { getByTestId, queryByTestId, getByText } = await render(<ShipmentChatScreen />);

    expect(getByTestId("chat-composer-readonly")).toBeTruthy();
    expect(getByText(/El envío finalizó. El chat queda en solo lectura y se archiva en 24 h./)).toBeTruthy();
    expect(queryByTestId("chat-composer-input")).toBeNull();
    expect(queryByTestId("chat-quick-replies")).toBeNull();
  });

  it("un mensaje que no se pudo enviar se reintenta o se descarta", async () => {
    const retry = jest.fn();
    const discard = jest.fn();
    const failed = message({ authorId: "ana", clientMessageId: "c-f", id: "", localState: "failed" });
    mockChat.mockReturnValue(state({ timeline: [item(failed, true)], retry, discard }));
    const { getByTestId } = await render(<ShipmentChatScreen />);

    await fireEvent.press(getByTestId("chat-message-c-f-retry"));
    expect(retry).toHaveBeenCalledWith("c-f");
    await fireEvent.press(getByTestId("chat-message-c-f-discard"));
    expect(discard).toHaveBeenCalledWith("c-f");
  });

  it("muestra la advertencia de lenguaje y se puede cerrar", async () => {
    const dismiss = jest.fn();
    mockChat.mockReturnValue(state({ timeline: [item(message({ authorId: "diego" }), false)], moderationWarning: true, dismissModerationWarning: dismiss }));
    const { getByText, getByTestId } = await render(<ShipmentChatScreen />);

    expect(getByText(CHAT_MODERATION_WARNING)).toBeTruthy();
    await fireEvent.press(getByTestId("chat-moderation-dismiss"));
    expect(dismiss).toHaveBeenCalled();
  });

  it("traduce el error de envío por su código", async () => {
    const { ApiError } = jest.requireActual("@movo/shared/dist/errors/api-error");
    mockChat.mockReturnValue(
      state({ timeline: [item(message({ authorId: "diego" }), false)], sendError: new ApiError(403, "CHAT_READ_ONLY", "x") }),
    );
    const { getByTestId } = await render(<ShipmentChatScreen />);

    expect(getByTestId("chat-send-error")).toHaveTextContent(/solo lectura/);
  });

  it("ante un chat cerrado muestra el error y ofrece reintentar", async () => {
    const { ApiError } = jest.requireActual("@movo/shared/dist/errors/api-error");
    const refetch = jest.fn();
    mockChat.mockReturnValue(state({ isError: true, error: new ApiError(409, "CHAT_CLOSED", "x"), refetch }));
    const { getByTestId, queryByTestId } = await render(<ShipmentChatScreen />);

    expect(getByTestId("chat-error")).toHaveTextContent(/ya no está disponible/);
    expect(queryByTestId("chat-composer-input")).toBeNull();
    await fireEvent.press(getByTestId("chat-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("'Tu seguridad' bloquea a un integrante y reporta la conversación", async () => {
    mockChat.mockReturnValue(state({ timeline: [item(message({ authorId: "diego" }), false)] }));
    const { getByTestId, getByText, getAllByText } = await render(<ShipmentChatScreen />);

    await fireEvent.press(getByTestId("chat-options"));
    expect(getByText("Tu seguridad")).toBeTruthy();
    expect(getByText("Bloquear a Diego")).toBeTruthy();
    expect(getAllByText("No verás sus mensajes en este chat.")).toHaveLength(2);
    await fireEvent.press(getByTestId("chat-safety-block-diego"));
    expect(mockToggleBlock).toHaveBeenCalledWith({ userId: "diego", block: true });

    await fireEvent.press(getByTestId("chat-safety-report"));
    expect(mockReport).toHaveBeenCalled();
  });

  it("a quien ya está bloqueado le ofrece desbloquear, y un reporte previo se ve como enviado", async () => {
    mockBlocked.mockReturnValue({ data: [{ id: "luis", fullName: "Luis Paz", photoUrl: null, blockedAt: "2026-10-01" }] });
    mockChat.mockReturnValue(state({ reportedByMe: true, timeline: [item(message({ authorId: "diego" }), false)] }));
    const { getByTestId, getByText } = await render(<ShipmentChatScreen />);

    await fireEvent.press(getByTestId("chat-options"));
    expect(getByText("Desbloquear a Luis")).toBeTruthy();
    expect(getByText("Volverás a ver sus mensajes.")).toBeTruthy();
    expect(getByText("Reporte enviado")).toBeTruthy();
    expect(getByText("Lo revisa el equipo de Movo.")).toBeTruthy();
    await fireEvent.press(getByTestId("chat-safety-block-luis"));
    expect(mockToggleBlock).toHaveBeenCalledWith({ userId: "luis", block: false });
  });

  it("tocar los avatares del encabezado o el de un mensaje abre el detalle del envío", async () => {
    mockChat.mockReturnValue(state({ timeline: [item(message({ authorId: "diego", clientMessageId: "c-d" }), false)] }));
    const { getByTestId } = await render(<ShipmentChatScreen />);

    await fireEvent.press(getByTestId("chat-header-avatars"));
    expect(router.dismissTo).toHaveBeenCalledWith("/(app)/shipments/s1");

    await fireEvent.press(getByTestId("chat-message-c-d-avatar"));
    expect(router.dismissTo).toHaveBeenCalledTimes(2);
  });
});
