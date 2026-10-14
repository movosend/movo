import { describe, it, expect } from "vitest";
import { ShipmentStatus, UserRole, CHAT_POST_DELIVERY_WINDOW_HOURS } from "@movo/shared";
import { chatArchiveInstant, isChatArchived, resolveChatAccess } from "../src/domain/chat-window";
import { computeDeliveryStatus } from "../src/domain/chat-receipts";
import { Shipment } from "../src/models/shipment";

const SENDER = "11111111-1111-4111-8111-111111111111";
const RECEIVER = "22222222-2222-4222-8222-222222222222";
const CARRIER = "33333333-3333-4333-8333-333333333333";
const FORMER_RECEIVER = "44444444-4444-4444-8444-444444444444";
const STRANGER = "55555555-5555-4555-8555-555555555555";

const DELIVERED_AT = new Date("2026-10-14T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    senderId: SENDER,
    receiverId: RECEIVER,
    carrierId: CARRIER,
    status: ShipmentStatus.ASSIGNED,
    deliveredAt: null,
    formerReceiverId: null,
    ...overrides,
  } as Shipment;
}

function access(s: Shipment, viewerId: string, roles: UserRole[] = []) {
  return resolveChatAccess({ shipment: s, viewerId, viewerRoles: roles });
}

describe("resolveChatAccess (MOVO-26)", () => {
  it.each([
    ShipmentStatus.ASSIGNMENT_PENDING,
    ShipmentStatus.ASSIGNED_UNFUNDED,
    ShipmentStatus.ASSIGNED,
    ShipmentStatus.IN_TRANSIT,
  ])("con transportista asignado y envío %s, las tres partes escriben", (status) => {
    const s = shipment({ status });
    expect(access(s, SENDER)).toBe("open");
    expect(access(s, RECEIVER)).toBe("open");
    expect(access(s, CARRIER)).toBe("open");
  });

  it.each([
    ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
    ShipmentStatus.PUBLISHED,
    ShipmentStatus.REJECTED_BY_RECEIVER,
    ShipmentStatus.CANCELLED,
  ])("envío %s: el chat está cerrado para las partes", (status) => {
    const s = shipment({ status, carrierId: status === ShipmentStatus.CANCELLED ? CARRIER : null });
    expect(access(s, SENDER)).toBe("closed");
  });

  it("sin transportista asignado no hay chat aunque el estado sea de los abiertos", () => {
    expect(access(shipment({ carrierId: null }), SENDER)).toBe("closed");
  });

  it.each([ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED, ShipmentStatus.DISPUTED])(
    "envío %s: queda en solo lectura para las tres partes, sin cerrarse nunca",
    (status) => {
      const s = shipment({ status, deliveredAt: DELIVERED_AT });
      expect(access(s, SENDER)).toBe("read_only");
      expect(access(s, RECEIVER)).toBe("read_only");
      expect(access(s, CARRIER)).toBe("read_only");
    }
  );

  describe("archivado a las 24 h de la entrega", () => {
    const delivered = shipment({ status: ShipmentStatus.DELIVERED, deliveredAt: DELIVERED_AT });

    it("antes del plazo no está archivado; pasado el plazo sí (en el borde exacto todavía no)", () => {
      const deadline = chatArchiveInstant(delivered)!;
      expect(deadline.getTime() - DELIVERED_AT.getTime()).toBe(CHAT_POST_DELIVERY_WINDOW_HOURS * HOUR_MS);
      expect(isChatArchived(delivered, new Date(DELIVERED_AT.getTime() + 23 * HOUR_MS))).toBe(false);
      expect(isChatArchived(delivered, deadline)).toBe(false);
      expect(isChatArchived(delivered, new Date(deadline.getTime() + 1))).toBe(true);
    });

    it("un envío completed usa el mismo plazo", () => {
      const completed = shipment({ status: ShipmentStatus.COMPLETED, deliveredAt: DELIVERED_AT });
      expect(isChatArchived(completed, new Date(DELIVERED_AT.getTime() + 25 * HOUR_MS))).toBe(true);
    });

    it("un envío en curso o sin deliveredAt nunca está archivado", () => {
      expect(isChatArchived(shipment(), new Date(DELIVERED_AT.getTime() + 100 * HOUR_MS))).toBe(false);
      expect(isChatArchived(shipment({ status: ShipmentStatus.DELIVERED, deliveredAt: null }), DELIVERED_AT)).toBe(false);
    });

    it("archivado sigue siendo solo lectura, no se cierra", () => {
      expect(access(delivered, SENDER)).toBe("read_only");
    });
  });

  it("el receptor original (ADR-038) nunca escribe: solo lee mientras el chat esté abierto", () => {
    const s = shipment({ status: ShipmentStatus.IN_TRANSIT, formerReceiverId: FORMER_RECEIVER });
    expect(access(s, FORMER_RECEIVER)).toBe("read_only");
    const cancelled = shipment({ status: ShipmentStatus.CANCELLED, formerReceiverId: FORMER_RECEIVER });
    expect(access(cancelled, FORMER_RECEIVER)).toBe("closed");
  });

  it("el admin siempre puede leer, incluso con el chat cerrado, y nunca escribe", () => {
    expect(access(shipment({ status: ShipmentStatus.CANCELLED }), STRANGER, [UserRole.ADMIN])).toBe("read_only");
    expect(access(shipment({ status: ShipmentStatus.IN_TRANSIT }), STRANGER, [UserRole.ADMIN])).toBe("read_only");
  });

  it("un admin que además es parte del envío se rige por las reglas de las partes", () => {
    expect(access(shipment({ status: ShipmentStatus.IN_TRANSIT }), SENDER, [UserRole.ADMIN])).toBe("open");
  });
});

describe("computeDeliveryStatus (tildes del chat)", () => {
  const sentAt = new Date("2026-10-14T12:00:00.000Z");
  const before = new Date(sentAt.getTime() - 1000);
  const after = new Date(sentAt.getTime() + 1000);
  const state = (userId: string, lastDeliveredAt: Date | null, lastReadAt: Date | null) => ({ userId, lastDeliveredAt, lastReadAt });

  it("sin nadie más (todos bloqueados o solo el autor) queda en enviado", () => {
    expect(computeDeliveryStatus(sentAt, [])).toBe("sent");
  });

  it("enviado hasta que TODOS los demás lo recibieron", () => {
    expect(computeDeliveryStatus(sentAt, [state("a", after, null), state("b", null, null)])).toBe("sent");
    expect(computeDeliveryStatus(sentAt, [state("a", after, null), state("b", before, null)])).toBe("sent");
  });

  it("entregado cuando todos lo recibieron pero no todos lo leyeron", () => {
    expect(computeDeliveryStatus(sentAt, [state("a", after, null), state("b", after, after)])).toBe("delivered");
  });

  it("leído solo cuando todos lo leyeron", () => {
    expect(computeDeliveryStatus(sentAt, [state("a", after, after), state("b", after, after)])).toBe("read");
    expect(computeDeliveryStatus(sentAt, [state("a", after, after), state("b", after, before)])).toBe("delivered");
  });

  it("el instante exacto del mensaje cuenta como recibido y leído", () => {
    expect(computeDeliveryStatus(sentAt, [state("a", sentAt, sentAt)])).toBe("read");
  });
});
