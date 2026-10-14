import type { ChatListItem } from "@movo/shared/dist/types/chat";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import ChatsScreen from "../app/(app)/chats";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const mockUseChatList = jest.fn();
jest.mock("../src/hooks/use-chat", () => ({ useChatList: () => mockUseChatList() }));
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { userId: "me" } }),
}));

function item(overrides: Partial<ChatListItem> = {}): ChatListItem {
  return {
    shipmentId: "11111-48210",
    status: ShipmentStatus.IN_TRANSIT,
    route: "Nueva Córdoba → Güemes",
    access: "open",
    archived: false,
    unreadCount: 0,
    lastMessage: { authorId: "diego", authorName: "Diego", body: "Ya retiré el paquete", hidden: false, createdAt: new Date().toISOString() },
    lastActivityAt: new Date().toISOString(),
    participants: [
      { userId: "ana", role: "sender", firstName: "Ana", fullName: "Ana Molina", photoUrl: null },
      { userId: "diego", role: "carrier", firstName: "Diego", fullName: "Diego Ramos", photoUrl: null },
      { userId: "luis", role: "receiver", firstName: "Luis", fullName: "Luis Paz", photoUrl: null },
    ],
    ...overrides,
  };
}

const base = { isLoading: false, isError: false, error: null, refetch: jest.fn(), isRefetching: false };

const { ApiError } = jest.requireActual("@movo/shared/dist/errors/api-error");

describe("ChatsScreen (MOVO-284)", () => {
  afterEach(() => jest.clearAllMocks());

  it("lista los chats con código, ruta, último mensaje y contador de no leídos", async () => {
    mockUseChatList.mockReturnValue({ ...base, data: [item({ unreadCount: 2 })] });
    const { getByText, getByTestId } = await render(<ChatsScreen />);

    expect(getByText("Chats")).toBeTruthy();
    expect(getByText("Uno por cada envío en curso")).toBeTruthy();
    expect(getByText("#MOVO-48210")).toBeTruthy();
    expect(getByText("Nueva Córdoba → Güemes")).toBeTruthy();
    expect(getByText("Diego: Ya retiré el paquete")).toBeTruthy();
    expect(getByTestId("chat-row-11111-48210-unread")).toHaveTextContent("2");
  });

  it("dibuja los avatares de los tres integrantes con sus iniciales", async () => {
    mockUseChatList.mockReturnValue({ ...base, data: [item()] });
    const { getByText } = await render(<ChatsScreen />);

    expect(getByText("AM")).toBeTruthy();
    expect(getByText("DR")).toBeTruthy();
    expect(getByText("LP")).toBeTruthy();
  });

  it("contra un backend que todavía no manda `participants` la lista no se rompe", async () => {
    const { participants: _omitted, ...withoutParticipants } = item();
    mockUseChatList.mockReturnValue({ ...base, data: [withoutParticipants] });
    const { getByText } = await render(<ChatsScreen />);

    expect(getByText("Nueva Córdoba → Güemes")).toBeTruthy();
  });

  it("un mensaje propio se muestra como 'Vos' y uno de un bloqueado no revela el contenido", async () => {
    mockUseChatList.mockReturnValue({
      ...base,
      data: [
        item({ shipmentId: "a-00001", lastMessage: { authorId: "me", authorName: "Ana", body: "Gracias", hidden: false, createdAt: new Date().toISOString() } }),
        item({ shipmentId: "b-00002", lastMessage: { authorId: "x", authorName: "Luis", body: "", hidden: true, createdAt: new Date().toISOString() } }),
      ],
    });
    const { getByText } = await render(<ChatsScreen />);

    expect(getByText("Vos: Gracias")).toBeTruthy();
    expect(getByText("Mensaje de un usuario bloqueado")).toBeTruthy();
  });

  it("los chats archivados o de solo lectura se muestran atenuados y los abiertos no", async () => {
    mockUseChatList.mockReturnValue({
      ...base,
      data: [
        item({ shipmentId: "a-00001" }),
        item({ shipmentId: "b-00002", access: "read_only" }),
        item({ shipmentId: "c-00003", access: "read_only", archived: true }),
      ],
    });
    const { getByTestId } = await render(<ChatsScreen />);

    const opacityOf = (id: string) => [getByTestId(id).props.style].flat(3).reduce((acc: number, s: any) => (s?.opacity ?? acc), 1);
    expect(opacityOf("chat-row-a-00001")).toBe(1);
    expect(opacityOf("chat-row-b-00002")).toBe(0.55);
    expect(opacityOf("chat-row-c-00003")).toBe(0.55);
  });

  it("tocar una fila abre la conversación de ese envío", async () => {
    mockUseChatList.mockReturnValue({ ...base, data: [item()] });
    const { getByTestId } = await render(<ChatsScreen />);

    await fireEvent.press(getByTestId("chat-row-11111-48210"));
    expect(router.push).toHaveBeenCalledWith("/(app)/shipments/11111-48210/chat");
  });

  it("sin chats muestra el estado vacío", async () => {
    mockUseChatList.mockReturnValue({ ...base, data: [] });
    const { getByTestId, getByText } = await render(<ChatsScreen />);

    expect(getByTestId("chats-empty")).toBeTruthy();
    expect(getByText("Todavía no tenés chats")).toBeTruthy();
  });

  it("ante un error ofrece reintentar", async () => {
    const refetch = jest.fn();
    mockUseChatList.mockReturnValue({ ...base, data: undefined, isError: true, error: new Error("x"), refetch });
    const { getByTestId } = await render(<ChatsScreen />);

    expect(getByTestId("chats-error")).toBeTruthy();
    await fireEvent.press(getByTestId("chats-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("un VALIDATION_FAILED (backend sin el endpoint) no muestra 'Revisá los datos ingresados'", async () => {
    mockUseChatList.mockReturnValue({ ...base, data: undefined, isError: true, error: new ApiError(400, "VALIDATION_FAILED", "x") });
    const { getByTestId } = await render(<ChatsScreen />);

    expect(getByTestId("chats-error")).toHaveTextContent("No pudimos cargar tus chats. Intentá de nuevo en unos minutos.");
  });
});
