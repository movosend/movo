import { describe, it, expect } from "vitest";
import {
  statusAfterUserMessage,
  supportRoomKey,
  toConversationItem,
  toLastMessage,
  toUserFacingMessage,
  userDeliveryStatus,
  SupportMessageFacts,
} from "../src/domain/support-rules";

const USER = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const at = (iso: string) => new Date(iso);

function message(overrides: Partial<SupportMessageFacts> = {}): SupportMessageFacts {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    conversationId: CONVERSATION,
    kind: "user",
    authorId: USER,
    authorName: null,
    body: "Hola",
    clientMessageId: "55555555-5555-4555-8555-555555555555",
    moderated: false,
    createdAt: at("2026-10-21T12:00:00.000Z"),
    ...overrides,
  };
}

describe("soporte: reglas de dominio (MOVO-320)", () => {
  describe("statusAfterUserMessage", () => {
    it("una resuelta se reabre", () => {
      expect(statusAfterUserMessage("resolved")).toEqual({ status: "open", reopened: true });
    });
    it("una que espera al usuario vuelve a open, sin ser una reapertura", () => {
      expect(statusAfterUserMessage("awaiting_user")).toEqual({ status: "open", reopened: false });
    });
    it("una abierta no cambia", () => {
      expect(statusAfterUserMessage("open")).toEqual({ status: "open", reopened: false });
    });
  });

  describe("userDeliveryStatus", () => {
    it("es 'sent' hasta que un agente abre la conversación", () => {
      expect(userDeliveryStatus(at("2026-10-21T12:00:00Z"), null)).toBe("sent");
      expect(userDeliveryStatus(at("2026-10-21T12:00:00Z"), at("2026-10-21T11:59:59Z"))).toBe("sent");
    });
    it("es 'read' si el agente leyó en o después de que se escribió", () => {
      expect(userDeliveryStatus(at("2026-10-21T12:00:00Z"), at("2026-10-21T12:00:00Z"))).toBe("read");
      expect(userDeliveryStatus(at("2026-10-21T12:00:00Z"), at("2026-10-21T12:05:00Z"))).toBe("read");
    });
  });

  describe("toUserFacingMessage", () => {
    it("una nota interna no tiene versión para el usuario", () => {
      expect(toUserFacingMessage(message({ kind: "note", authorId: AGENT, authorName: "Lucía" }), USER, null)).toBeNull();
    });

    it("el mensaje propio lleva tildes; el nombre del autor no se expone en los del usuario", () => {
      expect(toUserFacingMessage(message(), USER, null)).toMatchObject({
        kind: "user",
        authorName: null,
        deliveryStatus: "sent",
        attachments: [],
        createdAt: "2026-10-21T12:00:00.000Z",
      });
    });

    it("la respuesta de un agente lleva su nombre de pila y no lleva tildes", () => {
      expect(toUserFacingMessage(message({ kind: "agent", authorId: AGENT, authorName: "Lucía" }), USER, null)).toMatchObject({
        kind: "agent",
        authorName: "Lucía",
        deliveryStatus: null,
        moderated: false,
      });
    });

    it("un evento del sistema no tiene autor, tildes ni id de cliente", () => {
      const dto = toUserFacingMessage(
        message({ kind: "system", authorId: null, authorName: "Lucía", clientMessageId: null, body: "Se reabrió la conversación" }),
        USER,
        null
      );
      expect(dto).toMatchObject({ kind: "system", authorName: null, deliveryStatus: null, clientMessageId: null });
    });
  });

  describe("toLastMessage", () => {
    it("nunca es una nota ni un evento del sistema", () => {
      expect(toLastMessage(message({ kind: "note" }))).toBeNull();
      expect(toLastMessage(message({ kind: "system" }))).toBeNull();
      expect(toLastMessage(null)).toBeNull();
    });
    it("de un agente trae su nombre; del usuario, no", () => {
      expect(toLastMessage(message({ kind: "agent", authorName: "Lucía" }))).toMatchObject({ from: "agent", authorName: "Lucía" });
      expect(toLastMessage(message())).toMatchObject({ from: "user", authorName: null, hasAttachments: false });
    });
  });

  describe("toConversationItem", () => {
    const conversation = {
      id: CONVERSATION,
      codeNumber: 1042,
      userId: USER,
      topic: "payments" as const,
      status: "open" as const,
      shipmentId: null,
      lastMessageAt: at("2026-10-21T12:30:00.000Z"),
      lastAgentReadAt: null,
    };

    it("arma el código SOP y la actividad", () => {
      expect(toConversationItem(conversation, null, 3)).toEqual({
        id: CONVERSATION,
        code: "SOP-1042",
        topic: "payments",
        status: "open",
        shipment: null,
        lastMessage: null,
        unreadCount: 3,
        lastActivityAt: "2026-10-21T12:30:00.000Z",
      });
    });

    it("con envío vinculado lleva su código de display", () => {
      const item = toConversationItem({ ...conversation, shipmentId: "abcdef12-3456-4789-9abc-def012348765" }, null, 0);
      expect(item.shipment).toEqual({ id: "abcdef12-3456-4789-9abc-def012348765", code: "MOVO-48765" });
    });
  });

  it("la clave de sala de soporte no se confunde con la de un envío", () => {
    expect(supportRoomKey(CONVERSATION)).toBe(`support:${CONVERSATION}`);
    expect(supportRoomKey(CONVERSATION)).not.toBe(CONVERSATION);
  });
});
