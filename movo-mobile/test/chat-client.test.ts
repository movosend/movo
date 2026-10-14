import { chatClient } from "../src/api/chat-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

const get = httpClient.get as jest.Mock;
const post = httpClient.post as jest.Mock;

describe("chatClient (MOVO-284)", () => {
  afterEach(() => jest.clearAllMocks());

  it("lista los chats con GET /shipments/chats", async () => {
    get.mockResolvedValue({ items: [] });
    await chatClient.listChats();
    expect(get).toHaveBeenCalledWith("/shipments/chats");
  });

  it("pide el historial con cursor y límite", async () => {
    get.mockResolvedValue({ items: [], nextCursor: null });
    await chatClient.listMessages("s1", { cursor: "abc", limit: 30 });
    expect(get).toHaveBeenCalledWith("/shipments/s1/chat/messages", { cursor: "abc", limit: 30 });
  });

  it("envía el mensaje con su clientMessageId", async () => {
    post.mockResolvedValue({ id: "m1" });
    await chatClient.sendMessage("s1", "Hola", "client-1");
    expect(post).toHaveBeenCalledWith("/shipments/s1/chat/messages", { body: "Hola", clientMessageId: "client-1" });
  });

  it("trae integrantes, marca leído y reporta", async () => {
    get.mockResolvedValue({ participants: [] });
    post.mockResolvedValue({});
    await chatClient.getParticipants("s1");
    await chatClient.markRead("s1");
    await chatClient.reportConversation("s1");
    expect(get).toHaveBeenCalledWith("/shipments/s1/chat/participants");
    expect(post).toHaveBeenCalledWith("/shipments/s1/chat/read", {});
    expect(post).toHaveBeenCalledWith("/shipments/s1/chat/report", {});
  });
});
