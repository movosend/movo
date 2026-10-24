import type { ChatMessage } from "@movo/shared/dist/types/chat";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentEvent } from "../src/api/shipments-client";
import {
  chatAuthorLabel,
  buildChatTimeline,
  chatAvailability,
  chatEventCard,
  chatTransferCard,
  eventsSinceCurrentAssignment,
  chatReadOnlyCopy,
  deliveryStatusLabel,
  formatDayLabel,
  formatListTime,
  formatUnreadCount,
  joinNames,
  shortName,
} from "../src/lib/chat-format";

const NOW = new Date(2026, 9, 14, 15, 30); // 14 oct 2026, hora local

function msg(id: string, authorId: string, at: Date, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    shipmentId: "s1",
    authorId,
    authorName: "Alguien",
    body: `mensaje ${id}`,
    clientMessageId: `c-${id}`,
    moderated: false,
    hidden: false,
    deliveryStatus: null,
    createdAt: at.toISOString(),
    ...extra,
  };
}

function event(toStatus: ShipmentStatus, at: Date, id: string = toStatus, fromStatus: ShipmentStatus | null = null): ShipmentEvent {
  // Una aceptación entra desde `published`.
  const from =
    fromStatus ?? (toStatus === ShipmentStatus.ASSIGNMENT_PENDING || toStatus === ShipmentStatus.ASSIGNED_UNFUNDED ? ShipmentStatus.PUBLISHED : null);
  return { id, shipmentId: "s1", fromStatus: from, toStatus, actorId: null, reason: null, createdAt: at.toISOString() };
}

describe("formateo de textos del chat", () => {
  it("une los nombres con coma y 'y'", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Ana"])).toBe("Ana");
    expect(joinNames(["Ana", "Diego"])).toBe("Ana y Diego");
    expect(joinNames(["Ana", "Diego", "Luis"])).toBe("Ana, Diego y Luis");
  });

  it("separador de día: Hoy, Ayer o la fecha", () => {
    expect(formatDayLabel(new Date(2026, 9, 14, 9, 0).toISOString(), NOW)).toBe("Hoy");
    expect(formatDayLabel(new Date(2026, 9, 13, 23, 0).toISOString(), NOW)).toBe("Ayer");
    expect(formatDayLabel(new Date(2026, 9, 2, 12, 0).toISOString(), NOW)).toMatch(/2 oct/);
  });

  it("hora de la lista: hora de hoy, Ayer, día de la semana o fecha", () => {
    expect(formatListTime(new Date(2026, 9, 14, 8, 5).toISOString(), NOW)).toBe("08:05");
    expect(formatListTime(new Date(2026, 9, 13, 8, 5).toISOString(), NOW)).toBe("Ayer");
    expect(formatListTime(new Date(2026, 9, 11, 8, 5).toISOString(), NOW)).toMatch(/^[A-ZÁÉÍÓÚ]/);
    expect(formatListTime(new Date(2026, 8, 20, 8, 5).toISOString(), NOW)).toMatch(/20 sep/);
  });

  it("etiquetas de tildes y contador", () => {
    expect(deliveryStatusLabel("sent")).toBe("Enviado");
    expect(deliveryStatusLabel("delivered")).toBe("Entregado");
    expect(deliveryStatusLabel("read")).toBe("Leído por todos");
    expect(formatUnreadCount(3)).toBe("3");
    expect(formatUnreadCount(100)).toBe("99+");
  });

  it("copy de solo lectura según el motivo", () => {
    expect(chatReadOnlyCopy({ archived: false, status: ShipmentStatus.DELIVERED, isFormerReceiver: false })).toMatch(
      /se archiva en 24 h/
    );
    expect(chatReadOnlyCopy({ archived: true, status: ShipmentStatus.DELIVERED, isFormerReceiver: false })).toMatch(/archivado/);
    expect(chatReadOnlyCopy({ archived: false, status: ShipmentStatus.DISPUTED, isFormerReceiver: false })).toMatch(/disputa/);
    expect(chatReadOnlyCopy({ archived: false, status: ShipmentStatus.IN_TRANSIT, isFormerReceiver: true })).toMatch(/recepción/);
  });
});

describe("eventos de la asignación vigente", () => {
  const at = new Date("2026-10-14T12:00:00Z");
  const viewer = { role: "receiver" as const, carrierFirstName: "Diego", receiverFirstName: "Luis" };

  it("un hold perdido (assigned -> assigned_unfunded) no cuenta como una aceptación nueva", () => {
    const lost = event(ShipmentStatus.ASSIGNED_UNFUNDED, at, "lost", ShipmentStatus.ASSIGNED);
    expect(chatEventCard(lost, viewer)).toBeNull();
  });

  it("descarta los eventos de la asignación anterior y conserva los de la vigente", () => {
    const t = (min: number) => new Date(at.getTime() + min * 60_000);
    const events = [
      event(ShipmentStatus.PUBLISHED, t(0)),
      event(ShipmentStatus.ASSIGNMENT_PENDING, t(1), "accept-a"),
      event(ShipmentStatus.PUBLISHED, t(2), "back", ShipmentStatus.ASSIGNMENT_PENDING),
      event(ShipmentStatus.ASSIGNMENT_PENDING, t(3), "accept-b"),
      event(ShipmentStatus.ASSIGNED, t(4), "assigned"),
    ];
    expect(eventsSinceCurrentAssignment(events).map((e) => e.id)).toEqual(["accept-b", "assigned"]);
  });

  it("sin ninguna aceptación devuelve todo", () => {
    const events = [event(ShipmentStatus.IN_TRANSIT, at, "x")];
    expect(eventsSinceCurrentAssignment(events)).toHaveLength(1);
  });
});

describe("chatEventCard", () => {
  const at = new Date(2026, 9, 14, 10, 0);
  const viewer = (role: "sender" | "carrier" | "receiver") => ({ role, carrierFirstName: "Diego", receiverFirstName: "Luis" });

  it("usa los textos del prototipo según quién mira", () => {
    const accepted = event(ShipmentStatus.ASSIGNMENT_PENDING, at);
    expect(chatEventCard(accepted, viewer("carrier"))?.text).toBe("Aceptaste el envío");
    expect(chatEventCard(accepted, viewer("sender"))?.text).toBe("Diego aceptó el envío");
    expect(chatEventCard(event(ShipmentStatus.ASSIGNED_UNFUNDED, at), viewer("receiver"))?.text).toBe("Diego aceptó el envío");

    const pickup = event(ShipmentStatus.IN_TRANSIT, at);
    expect(chatEventCard(pickup, viewer("carrier"))).toMatchObject({ text: "Escaneaste el QR de retiro", live: true });
    expect(chatEventCard(pickup, viewer("sender"))?.text).toBe("Diego escaneó el QR de retiro");
    expect(chatEventCard(pickup, viewer("receiver"))?.text).toBe("Diego retiró el paquete");

    const delivered = event(ShipmentStatus.DELIVERED, at);
    expect(chatEventCard(delivered, viewer("receiver"))?.text).toBe("Confirmaste la entrega con QR");
    expect(chatEventCard(delivered, viewer("carrier"))?.text).toBe("Luis confirmó la entrega con QR");
  });

  it("sin nombres usa un texto neutro y cubre disputa y cancelación", () => {
    const neutral = { role: "sender" as const, carrierFirstName: null, receiverFirstName: null };
    expect(chatEventCard(event(ShipmentStatus.ASSIGNMENT_PENDING, at), neutral)?.text).toBe("El transportista aceptó el envío");
    expect(chatEventCard(event(ShipmentStatus.DISPUTED, at), neutral)?.text).toBe("Disputa abierta");
    expect(chatEventCard(event(ShipmentStatus.CANCELLED, at), neutral)?.text).toBe("Envío cancelado");
  });

  it("no hay tarjeta para la creación, la publicación ni el pago", () => {
    for (const status of [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, ShipmentStatus.PUBLISHED, ShipmentStatus.ASSIGNED, ShipmentStatus.COMPLETED]) {
      expect(chatEventCard(event(status, at), viewer("sender"))).toBeNull();
    }
  });
});

describe("shortName", () => {
  it("deja el primer nombre y la inicial del apellido", () => {
    expect(shortName("Ana Molina")).toBe("Ana M.");
    expect(shortName("Juan Cruz Bordino Blanche")).toBe("Juan B.");
    expect(shortName("Diego")).toBe("Diego");
    expect(shortName(null)).toBe("");
  });
});

describe("buildChatTimeline", () => {
  const ME = "me";
  const T = (h: number, m = 0, day = 14) => new Date(2026, 9, day, h, m);

  it("devuelve del más nuevo al más viejo, con separador de día arriba del primer ítem de cada día", () => {
    const items = buildChatTimeline({
      messages: [msg("1", "diego", T(9, 0, 13)), msg("2", ME, T(9, 5, 14)), msg("3", "diego", T(9, 6, 14))],
      events: [],
      currentUserId: ME,
      now: NOW,
    });

    expect(items.map((i) => i.kind)).toEqual(["message", "message", "day", "message", "day"]);
    const days = items.filter((i) => i.kind === "day").map((i) => (i.kind === "day" ? i.label : ""));
    expect(days).toEqual(["Hoy", "Ayer"]);
  });

  it("agrupa las burbujas seguidas de la misma persona: nombre en la primera, avatar en la última", () => {
    const items = buildChatTimeline({
      messages: [msg("1", "diego", T(9, 0)), msg("2", "diego", T(9, 1)), msg("3", ME, T(9, 2))],
      events: [],
      currentUserId: ME,
      now: NOW,
    });
    const messages = items.filter((i) => i.kind === "message");
    // Orden nuevo → viejo: [mío, diego(2), diego(1)]
    expect(messages.map((m) => (m.kind === "message" ? m.mine : null))).toEqual([true, false, false]);
    const second = messages[1];
    const third = messages[2];
    if (second.kind !== "message" || third.kind !== "message") throw new Error("esperaba mensajes");
    expect(second.showAvatar).toBe(true);
    expect(second.showName).toBe(false);
    expect(third.showName).toBe(true);
    expect(third.showAvatar).toBe(false);
    expect(third.groupStart).toBe(true);
  });

  it("intercala las tarjetas de evento por fecha entre los mensajes", () => {
    const items = buildChatTimeline({
      messages: [msg("1", "diego", T(9, 0)), msg("2", ME, T(9, 30))],
      events: [{ id: "e1", text: "Retiro confirmado", live: false, createdAt: T(9, 10).toISOString() }],
      currentUserId: ME,
      now: NOW,
    });
    expect(items.filter((i) => i.kind !== "day").map((i) => i.kind)).toEqual(["message", "event", "message"]);
  });

  it("un mensaje propio que todavía no se confirmó usa su clientMessageId como clave estable", () => {
    const pending = { ...msg("", ME, T(9, 0)), id: "", clientMessageId: "abc", localState: "sending" as const };
    const items = buildChatTimeline({ messages: [pending], events: [], currentUserId: ME, now: NOW });
    expect(items.find((i) => i.kind === "message")?.key).toBe("message-abc");
  });

  it("sin mensajes ni eventos no hay nada que dibujar", () => {
    expect(buildChatTimeline({ messages: [], events: [], currentUserId: ME, now: NOW })).toEqual([]);
  });
});

describe("chatAvailability", () => {
  it("abierto con transportista y sin entregar", () => {
    for (const status of [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED, ShipmentStatus.ASSIGNED, ShipmentStatus.IN_TRANSIT]) {
      expect(chatAvailability(status, "carrier-1")).toBe("open");
    }
  });

  it("solo lectura entregado, completado o en disputa", () => {
    for (const status of [ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED, ShipmentStatus.DISPUTED]) {
      expect(chatAvailability(status, "carrier-1")).toBe("read_only");
    }
  });

  it("sin chat si no hay transportista o el envío se canceló", () => {
    expect(chatAvailability(ShipmentStatus.PUBLISHED, null)).toBeNull();
    expect(chatAvailability(ShipmentStatus.ASSIGNED, null)).toBeNull();
    expect(chatAvailability(ShipmentStatus.CANCELLED, "carrier-1")).toBeNull();
    expect(chatAvailability(ShipmentStatus.REJECTED_BY_RECEIVER, "carrier-1")).toBeNull();
  });
});

describe("chatAuthorLabel (MOVO-301)", () => {
  const participants = [{ userId: "u1", fullName: "Ana Molina", role: "sender" as const }];

  it("usa el rol de la lista de participantes", () => {
    expect(chatAuthorLabel({ authorId: "u1", authorName: "Ana", participants })).toBe("Ana M. · Emisor");
  });

  it("sin participante, saca el rol de los ids del envío", () => {
    expect(chatAuthorLabel({ authorId: "u2", authorName: "Diego Ramos", participants, shipment: { carrierId: "u2" } })).toBe(
      "Diego R. · Transportista",
    );
  });

  it("un autor que ya no figura se marca como ex integrante, nunca con el rol de quien lo reemplazó", () => {
    expect(
      chatAuthorLabel({ authorId: "viejo", authorName: "Pedro Gómez", participants, shipment: { receiverId: "nuevo" } }),
    ).toBe("Pedro G. · Ex integrante");
  });

  it("sin nombre ni participante no inventa una etiqueta", () => {
    expect(chatAuthorLabel({ authorId: "x", authorName: null, participants })).toBeUndefined();
  });
});

describe("chatTransferCard (MOVO-340)", () => {
  const transfer = {
    id: "t1",
    shipmentId: "s1",
    requestedBy: "lucia",
    requesterName: "Lucía Gómez",
    newReceiverId: "martin",
    newReceiverName: "Martín López",
    reason: null,
    responseReason: null,
    status: "completed" as const,
    cancelReason: null,
    newReceiverDeadline: "2026-10-14T18:00:00.000Z",
    createdAt: "2026-10-14T12:00:00.000Z",
    resolvedAt: "2026-10-14T13:00:00.000Z",
    resolvedBy: "martin",
  };

  it("el texto depende de quién mira, y la tarjeta va en el momento en que se completó", () => {
    expect(chatTransferCard(transfer, "lucia")).toEqual({
      id: "receiver-transfer-t1",
      text: "Le pasaste la recepción a Martín",
      live: false,
      createdAt: "2026-10-14T13:00:00.000Z",
    });
    expect(chatTransferCard(transfer, "martin")?.text).toBe("Lucía te pasó la recepción");
    expect(chatTransferCard(transfer, "diego")?.text).toBe("Lucía le pasó la recepción a Martín");
  });

  it("una solicitud que no se completó no lleva tarjeta", () => {
    expect(chatTransferCard({ ...transfer, status: "rejected_by_new_receiver" }, "diego")).toBeNull();
    expect(chatTransferCard({ ...transfer, status: "pending_new_receiver", resolvedAt: null }, "diego")).toBeNull();
  });
});
