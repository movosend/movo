import type { ChatMessage, ChatMessagesPage } from "@movo/shared/dist/types/chat";
import type { InfiniteData } from "@tanstack/react-query";
import { flattenMessages, totalUnread, upsertMessageInCache } from "../src/hooks/use-chat";

function msg(id: string, clientMessageId: string, body = id): ChatMessage {
  return {
    id,
    shipmentId: "s1",
    authorId: "a",
    authorName: "Ana",
    body,
    clientMessageId,
    moderated: false,
    hidden: false,
    deliveryStatus: null,
    createdAt: "2026-10-14T12:00:00.000Z",
  };
}

function page(items: ChatMessage[], nextCursor: string | null = null): ChatMessagesPage {
  return { items, nextCursor, access: "open", archived: false, reportedByMe: false };
}

function data(...pages: ChatMessagesPage[]): InfiniteData<ChatMessagesPage> {
  return { pages, pageParams: pages.map(() => undefined) };
}

describe("caché del chat (MOVO-284)", () => {
  it("flattenMessages junta las páginas y no repite un mensaje que llegó dos veces", () => {
    const result = flattenMessages(data(page([msg("3", "c3"), msg("2", "c2")], "cur"), page([msg("2", "c2"), msg("1", "c1")])));
    expect(result.map((m) => m.id)).toEqual(["3", "2", "1"]);
  });

  it("flattenMessages tolera que no haya datos", () => {
    expect(flattenMessages(undefined)).toEqual([]);
  });

  it("upsertMessageInCache suma un mensaje nuevo arriba de la primera página", () => {
    const next = upsertMessageInCache(data(page([msg("1", "c1")])), msg("2", "c2"));
    expect(next?.pages[0].items.map((m) => m.id)).toEqual(["2", "1"]);
  });

  it("upsertMessageInCache reemplaza al existente en vez de duplicarlo (mismo clientMessageId)", () => {
    const sent = { ...msg("srv-1", "c1"), deliveryStatus: "sent" as const };
    const next = upsertMessageInCache(data(page([msg("srv-1", "c1")])), sent);
    expect(next?.pages[0].items).toHaveLength(1);
    expect(next?.pages[0].items[0].deliveryStatus).toBe("sent");
  });

  it("upsertMessageInCache no hace nada si todavía no se cargó el historial", () => {
    expect(upsertMessageInCache(undefined, msg("1", "c1"))).toBeUndefined();
  });

  it("totalUnread suma los no leídos de todos los chats", () => {
    expect(totalUnread([{ unreadCount: 2 }, { unreadCount: 5 }] as never)).toBe(7);
    expect(totalUnread(undefined)).toBe(0);
  });
});
