import type { SupportThreadMessage } from "@movo/shared/dist/types/support";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { router } from "expo-router";
import PendingSupportConversationScreen from "../app/(app)/support/pending";
import SupportConversationScreen from "../app/(app)/support/[id]";
import { buildTimeline } from "../src/lib/chat-format";
import { SUPPORT_ME_ID, supportToChatMessage, supportToEventCard } from "../src/lib/support-format";
import { resetNavigationGuard } from "../src/lib/navigation-guard";
import { useSupportDraftStore } from "../src/store/support-draft-store";

let mockParams: Record<string, string> = { id: "c1" };
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require("react-native");
    return <Text>redirect:{href}</Text>;
  },
}));

jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid-x" }));
jest.mock("../src/hooks/use-support-photos", () => ({
  useSupportPhotos: () => ({
    photos: [],
    add: jest.fn(),
    retry: jest.fn(),
    remove: jest.fn(),
    reset: jest.fn(),
    uploadedIds: [],
    canAddMore: true,
    hasPending: false,
    max: 4,
  }),
}));

const mockConv: Record<string, any> = {};
jest.mock("../src/hooks/use-support-conversation", () => ({
  useSupportConversation: (...args: unknown[]) => {
    mockConv.lastArgs = args;
    return mockConv.value;
  },
}));

const mockCreateMutate = jest.fn();
const mockSetQueryData = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ setQueryData: (...args: unknown[]) => mockSetQueryData(...args) }),
}));
jest.mock("../src/hooks/use-support", () => ({
  supportKeys: { messages: (id: string) => ["support", "messages", id] },
  useCreateSupportConversation: () => ({ mutate: (...args: unknown[]) => mockCreateMutate(...args) }),
}));

function m(over: Partial<SupportThreadMessage>): SupportThreadMessage {
  return {
    id: "m1",
    conversationId: "c1",
    kind: "user",
    authorName: null,
    body: "Hola",
    clientMessageId: "cm1",
    moderated: false,
    deliveryStatus: "sent",
    attachments: [],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function timelineOf(messages: SupportThreadMessage[], localState?: "sending" | "failed") {
  return buildTimeline({
    messages: messages.filter((x) => x.kind !== "system").map((x) => supportToChatMessage(x, localState)),
    events: messages.filter((x) => x.kind === "system").map(supportToEventCard),
    currentUserId: SUPPORT_ME_ID,
  });
}

function conversationState(over: Record<string, unknown> = {}) {
  return {
    conversation: { id: "c1", code: "SOP-1042", topic: "shipment", status: "open", shipment: null, lastMessage: null, unreadCount: 0, lastActivityAt: "x" },
    resolved: false,
    timeline: timelineOf([m({})]),
    unavailable: false,
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
    refreshAttachments: jest.fn(),
    channelState: "connected",
    ...over,
  };
}

describe("SupportConversationScreen (MOVO-324)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNavigationGuard();
    mockParams = { id: "c1" };
    mockConv.value = conversationState();
  });

  it("encabezado 'Soporte de Movo' con código y tema, y los mensajes dibujados", async () => {
    const { getByText } = await render(<SupportConversationScreen />);

    expect(getByText("Soporte de Movo")).toBeTruthy();
    expect(getByText("SOP-1042 · Envío")).toBeTruthy();
    expect(getByText("Hola")).toBeTruthy();
  });

  it("los mensajes del equipo llevan el nombre del agente y el isotipo; el evento del sistema es una línea discreta", async () => {
    mockConv.value = conversationState({
      timeline: timelineOf([
        m({ id: "a", clientMessageId: "ca", body: "Mi consulta" }),
        m({ id: "s", kind: "system", authorName: null, clientMessageId: "", body: "Lucía Ferreyra tomó la conversación" }),
        m({ id: "b", kind: "agent", authorName: "Lucía", clientMessageId: "", body: "Hola Julia, ya lo reviso" }),
      ]),
    });
    const { getByText, getAllByTestId } = await render(<SupportConversationScreen />);

    expect(getByText("Lucía · Movo")).toBeTruthy();
    expect(getByText(/Lucía Ferreyra tomó la conversación/)).toBeTruthy();
    expect(getAllByTestId("support-agent-isotype").length).toBeGreaterThan(0);
  });

  it("con un envío vinculado muestra la tarjeta y tocarla abre el detalle del envío", async () => {
    mockConv.value = conversationState({
      conversation: { id: "c1", code: "SOP-1042", topic: "shipment", status: "open", shipment: { id: "s1", code: "MOVO-48213" }, lastMessage: null, unreadCount: 0, lastActivityAt: "x" },
    });
    const { getByTestId, getByText } = await render(<SupportConversationScreen />);

    expect(getByText("MOVO-48213")).toBeTruthy();
    await fireEvent.press(getByTestId("support-linked-shipment"));
    expect(router.push).toHaveBeenCalledWith("/(app)/shipments/s1");
  });

  it("sin envío vinculado no hay tarjeta", async () => {
    const { queryByTestId } = await render(<SupportConversationScreen />);
    expect(queryByTestId("support-linked-shipment")).toBeNull();
  });

  it("enviar manda el texto al hook", async () => {
    const { getByTestId } = await render(<SupportConversationScreen />);

    await fireEvent.changeText(getByTestId("support-composer-input"), "Sí, hay portero");
    await fireEvent.press(getByTestId("support-composer-send"));

    expect(mockConv.value.send).toHaveBeenCalledWith("Sí, hay portero", []);
  });

  it("consulta resuelta: cartel de resuelta y el campo sigue habilitado", async () => {
    mockConv.value = conversationState({ resolved: true });
    const { getByTestId, getByText, queryByTestId } = await render(<SupportConversationScreen />);

    expect(getByTestId("support-resolved-banner")).toBeTruthy();
    expect(getByText("Esta consulta está resuelta. Escribí de nuevo para reabrirla.")).toBeTruthy();
    expect(getByTestId("support-composer-input").props.editable).not.toBe(false);
    expect(queryByTestId("support-composer-readonly")).toBeNull();

    await fireEvent.changeText(getByTestId("support-composer-input"), "Sigue pasando");
    await fireEvent.press(getByTestId("support-composer-send"));
    expect(mockConv.value.send).toHaveBeenCalledWith("Sigue pasando", []);
  });

  it("abierta no muestra el cartel de resuelta", async () => {
    const { queryByTestId } = await render(<SupportConversationScreen />);
    expect(queryByTestId("support-resolved-banner")).toBeNull();
  });

  it("lenguaje moderado: muestra la advertencia del chat y se puede cerrar", async () => {
    mockConv.value = conversationState({ moderationWarning: true });
    const { getByText, getByTestId } = await render(<SupportConversationScreen />);

    expect(getByText(/Cuidá tu lenguaje/)).toBeTruthy();
    await fireEvent.press(getByTestId("chat-moderation-dismiss"));
    expect(mockConv.value.dismissModerationWarning).toHaveBeenCalled();
  });

  it("mensaje que falló: ofrece Reintentar y Descartar con el mismo clientMessageId", async () => {
    mockConv.value = conversationState({ timeline: timelineOf([m({ clientMessageId: "cm-fail" })], "failed") });
    const { getByText, getByTestId } = await render(<SupportConversationScreen />);

    expect(getByText("No se envió.")).toBeTruthy();
    await fireEvent.press(getByTestId("support-message-cm-fail-retry"));
    expect(mockConv.value.retry).toHaveBeenCalledWith("cm-fail");
    await fireEvent.press(getByTestId("support-message-cm-fail-discard"));
    expect(mockConv.value.discard).toHaveBeenCalledWith("cm-fail");
  });

  it("los tildes de sus mensajes dicen Enviado / Leído", async () => {
    mockConv.value = conversationState({ timeline: timelineOf([m({ deliveryStatus: "read" })]) });
    const { getByTestId } = await render(<SupportConversationScreen />);

    await fireEvent.press(getByTestId("support-message-cm1-ticks"));
    expect(getByTestId("support-message-cm1-status")).toHaveTextContent("Leído");
  });

  it("las imágenes se ven como miniaturas y al tocarlas se abre el visor (pidiendo URLs nuevas)", async () => {
    mockConv.value = conversationState({
      timeline: timelineOf([
        m({ attachments: [{ id: "a1", contentType: "image/jpeg", url: "https://x/1.jpg" }, { id: "a2", contentType: "image/jpeg", url: "https://x/2.jpg" }] }),
      ]),
    });
    const { getByTestId, queryByTestId } = await render(<SupportConversationScreen />);
    expect(getByTestId("support-message-cm1-attachment-0")).toBeTruthy();
    expect(getByTestId("support-message-cm1-attachment-1")).toBeTruthy();
    expect(queryByTestId("support-photo-viewer-list")).toBeNull();

    await fireEvent.press(getByTestId("support-message-cm1-attachment-1"));

    expect(mockConv.value.refreshAttachments).toHaveBeenCalled();
    await waitFor(() => expect(getByTestId("support-photo-viewer-list")).toBeTruthy());
  });

  it("solo fotos: la burbuja no dibuja texto vacío", async () => {
    mockConv.value = conversationState({
      timeline: timelineOf([m({ body: "", attachments: [{ id: "a1", contentType: "image/jpeg", url: "https://x/1.jpg" }] })]),
    });
    const { getByTestId } = await render(<SupportConversationScreen />);
    expect(getByTestId("support-message-cm1-attachments")).toBeTruthy();
  });

  it("cargando muestra el indicador y sin composer; error muestra mensaje con reintento", async () => {
    mockConv.value = conversationState({ isLoading: true, timeline: [] });
    const first = await render(<SupportConversationScreen />);
    expect(first.queryByTestId("support-composer-input")).toBeNull();
    await first.unmount();

    const refetch = jest.fn();
    mockConv.value = conversationState({ isError: true, error: new Error("x"), refetch, timeline: [] });
    const { getByTestId } = await render(<SupportConversationScreen />);
    expect(getByTestId("support-error")).toBeTruthy();
    await fireEvent.press(getByTestId("support-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("el error de envío se traduce y se muestra", async () => {
    const { ApiError } = jest.requireActual("@movo/shared/dist/errors/api-error");
    mockConv.value = conversationState({ sendError: new ApiError(422, "SUPPORT_ATTACHMENT_INVALID", "x") });
    const { getByTestId } = await render(<SupportConversationScreen />);
    expect(getByTestId("support-send-error")).toHaveTextContent(/No pudimos usar una de las fotos/);
  });

  it("si la consulta ya no existe (4004) avisa y vuelve a la lista", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.());
    mockConv.value = conversationState({ unavailable: true });
    await render(<SupportConversationScreen />);

    expect(alertSpy).toHaveBeenCalledWith("Esta consulta ya no está disponible", undefined, expect.any(Array));
    expect(router.back).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("abierta tras crear con lenguaje moderado arranca con la advertencia", async () => {
    mockParams = { id: "c1", moderated: "1" };
    await render(<SupportConversationScreen />);
    expect((mockConv.lastArgs as unknown[])[1]).toMatchObject({ initialModerationWarning: true });
  });
});

describe("PendingSupportConversationScreen (MOVO-324): la consulta que se está creando", () => {
  const draft = {
    topic: "payments" as const,
    body: "Me cobraron dos veces",
    clientMessageId: "cm-draft",
    shipment: null,
    attachments: [{ attachmentId: "att-1", localUri: "file:///a.jpg" }],
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useSupportDraftStore.setState({ draft });
  });

  it("muestra la burbuja 'Enviando…' con solo el tema como subtítulo y hace el POST con el borrador", async () => {
    const { getByText, queryByTestId } = await render(<PendingSupportConversationScreen />);

    expect(getByText("Pagos")).toBeTruthy();
    expect(getByText("Me cobraron dos veces")).toBeTruthy();
    expect(getByText("Enviando…")).toBeTruthy();
    expect(queryByTestId("support-composer-input")).toBeNull();
    expect(mockCreateMutate).toHaveBeenCalledWith(
      { topic: "payments", body: "Me cobraron dos veces", clientMessageId: "cm-draft", attachmentIds: ["att-1"] },
      expect.any(Object),
    );
  });

  it("al crearse siembra el caché y pasa a la conversación real", async () => {
    await render(<PendingSupportConversationScreen />);
    const { onSuccess } = mockCreateMutate.mock.calls[0][1];
    const conversation = { id: "real-1", code: "SOP-1050" };

    await act(async () => onSuccess({ conversation, message: m({ moderated: true }) }));

    expect(mockSetQueryData).toHaveBeenCalledWith(["support", "messages", "real-1"], expect.objectContaining({ pages: [expect.objectContaining({ conversation })] }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/support/[id]", params: { id: "real-1", moderated: "1" } });
    expect(useSupportDraftStore.getState().draft).toBeNull();
  });

  it("si falla ofrece reintentar con el MISMO clientMessageId y descartar", async () => {
    const { getByText, getByTestId, findByText } = await render(<PendingSupportConversationScreen />);
    const { onError } = mockCreateMutate.mock.calls[0][1];
    await act(async () => onError(new Error("red")));

    expect(await findByText("No se envió.")).toBeTruthy();
    await fireEvent.press(getByTestId("support-message-cm-draft-retry"));
    expect(mockCreateMutate).toHaveBeenCalledTimes(2);
    expect(mockCreateMutate.mock.calls[1][0].clientMessageId).toBe("cm-draft");
    // El segundo intento también falla: queda para descartar.
    await act(async () => mockCreateMutate.mock.calls[1][1].onError(new Error("red")));

    await fireEvent.press(getByTestId("support-message-cm-draft-discard"));
    expect(useSupportDraftStore.getState().draft).toBeNull();
    expect(router.back).toHaveBeenCalled();
    expect(getByText).toBeDefined();
  });

  it("sin borrador (la app se reinició) vuelve a Mis consultas", async () => {
    useSupportDraftStore.setState({ draft: null });
    const { getByText } = await render(<PendingSupportConversationScreen />);
    expect(getByText("redirect:/support/conversations")).toBeTruthy();
  });
});
