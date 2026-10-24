import type { SupportConversationItem, SupportUserFacingMessage } from "@movo/shared/dist/types/support";
import { buildTimeline } from "../src/lib/chat-format";
import {
  SUPPORT_ME_ID,
  supportAgentLabel,
  supportHeaderSubtitle,
  supportLastMessagePreview,
  supportShipmentSummary,
  supportStatusLabel,
  supportStatusTone,
  supportToChatMessage,
  supportToEventCard,
  supportTotalUnread,
  type SupportChatMessage,
  type SupportEventCard,
} from "../src/lib/support-format";

function item(over: Partial<SupportConversationItem> = {}): SupportConversationItem {
  return {
    id: "c1",
    code: "SOP-1042",
    topic: "shipment",
    status: "open",
    shipment: null,
    lastMessage: { from: "agent", authorName: "Lucía", body: "Hola", hasAttachments: false, createdAt: "2026-10-20T12:00:00.000Z" },
    unreadCount: 0,
    lastActivityAt: "2026-10-20T12:00:00.000Z",
    ...over,
  };
}

function message(over: Partial<SupportUserFacingMessage>): SupportUserFacingMessage {
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
    createdAt: "2026-10-20T12:00:00.000Z",
    ...over,
  };
}

describe("support-format (MOVO-324)", () => {
  it("la vista previa dice 'Movo:' si escribió el equipo y 'Vos:' si escribió el usuario", () => {
    expect(supportLastMessagePreview(item())).toBe("Movo: Hola");
    expect(
      supportLastMessagePreview(item({ lastMessage: { from: "user", authorName: null, body: "Gracias", hasAttachments: false, createdAt: "x" } })),
    ).toBe("Vos: Gracias");
  });

  it("sin texto y con adjunto la vista previa dice 'Foto'", () => {
    const preview = supportLastMessagePreview(
      item({ lastMessage: { from: "agent", authorName: "Lucía", body: "", hasAttachments: true, createdAt: "x" } }),
    );
    expect(preview).toBe("Movo: Foto");
  });

  it("sin mensajes todavía avisa que no hay", () => {
    expect(supportLastMessagePreview(item({ lastMessage: null }))).toBe("Todavía no hay mensajes");
  });

  it("textos y tonos de estado", () => {
    expect(supportStatusLabel("open")).toBe("Abierta");
    expect(supportStatusLabel("awaiting_user")).toBe("Esperando tu respuesta");
    expect(supportStatusLabel("resolved")).toBe("Resuelta");
    expect(supportStatusTone("awaiting_user")).toBe("warning");
    expect(supportStatusTone("resolved")).toBe("neutral");
  });

  it("suma los no leídos de todas las consultas", () => {
    expect(supportTotalUnread([item({ unreadCount: 2 }), item({ id: "c2", unreadCount: 1 })])).toBe(3);
    expect(supportTotalUnread(undefined)).toBe(0);
  });

  it("subtítulo del encabezado: código y tema, o solo el tema mientras no hay código", () => {
    expect(supportHeaderSubtitle(item())).toBe("SOP-1042 · Envío");
    expect(supportHeaderSubtitle(undefined, "payments")).toBe("Pagos");
  });

  it("resumen del envío en el selector, con o sin estado conocido", () => {
    expect(supportShipmentSummary({ code: "MOVO-48213", status: "in_transit" })).toBe("MOVO-48213 · En camino");
    expect(supportShipmentSummary({ code: "MOVO-48213", status: "" })).toBe("MOVO-48213");
  });

  it("el nombre del agente lleva 'Movo' y sin nombre queda solo 'Movo'", () => {
    expect(supportAgentLabel("Lucía Ferreyra")).toBe("Lucía · Movo");
    expect(supportAgentLabel(null)).toBe("Movo");
  });

  it("mapea el mensaje propio y el del equipo a la forma del chat, agrupando al equipo por agente", () => {
    const mine = supportToChatMessage(message({ deliveryStatus: "read" }));
    const agent = supportToChatMessage(message({ id: "m2", kind: "agent", authorName: "Lucía", clientMessageId: "" }));
    expect(mine.authorId).toBe(SUPPORT_ME_ID);
    expect(mine.deliveryStatus).toBe("read");
    expect(agent.authorId).toBe("agent:Lucía");
    expect(agent.deliveryStatus).toBeNull();
    expect(supportToChatMessage(message({}), "failed").localState).toBe("failed");
  });

  it("el timeline compartido agrupa por agente, marca lo propio y deja el evento como línea aparte", () => {
    const t = (iso: string) => `2026-10-20T${iso}.000Z`;
    const messages: SupportChatMessage[] = [
      supportToChatMessage(message({ id: "a", clientMessageId: "ca", createdAt: t("12:00:00") })),
      supportToChatMessage(message({ id: "b", kind: "agent", authorName: "Lucía", clientMessageId: "", createdAt: t("12:05:00") })),
      supportToChatMessage(message({ id: "c", kind: "agent", authorName: "Lucía", clientMessageId: "", createdAt: t("12:06:00") })),
    ];
    const events: SupportEventCard[] = [supportToEventCard(message({ id: "e", kind: "system", body: "Lucía Ferreyra tomó la conversación", createdAt: t("12:02:00") }))];

    const timeline = buildTimeline({ messages, events, currentUserId: SUPPORT_ME_ID, now: new Date("2026-10-20T15:00:00.000Z") });

    // Del más nuevo al más viejo: c, b, evento, a, separador del día.
    expect(timeline.map((i) => i.kind)).toEqual(["message", "message", "event", "message", "day"]);
    const [c, b, , a] = timeline;
    expect(c.kind === "message" && c.showAvatar && !c.showName).toBe(true);
    expect(b.kind === "message" && b.showName && !b.showAvatar).toBe(true);
    expect(a.kind === "message" && a.mine).toBe(true);
  });
});
