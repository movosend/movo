import { describe, it, expect } from "vitest";
import { ShipmentStatus, UserRole, CHAT_POST_DELIVERY_WINDOW_HOURS } from "@movo/shared";
import { chatWindowDeadline, resolveChatAccess } from "../src/domain/chat-window";
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

function access(s: Shipment, viewerId: string, now: Date = DELIVERED_AT, roles: UserRole[] = []) {
  return resolveChatAccess({ shipment: s, viewerId, viewerRoles: roles, now });
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

  describe("ventana de 24 h posteriores a la entrega", () => {
    const delivered = shipment({ status: ShipmentStatus.DELIVERED, deliveredAt: DELIVERED_AT });

    it("dentro de la ventana sigue abierto", () => {
      expect(access(delivered, SENDER, new Date(DELIVERED_AT.getTime() + 23 * HOUR_MS))).toBe("open");
    });

    it("en el instante exacto del cierre todavía está abierto y un milisegundo después se cierra", () => {
      const deadline = chatWindowDeadline(delivered)!;
      expect(deadline.getTime() - DELIVERED_AT.getTime()).toBe(CHAT_POST_DELIVERY_WINDOW_HOURS * HOUR_MS);
      expect(access(delivered, CARRIER, deadline)).toBe("open");
      expect(access(delivered, CARRIER, new Date(deadline.getTime() + 1))).toBe("closed");
    });

    it("un envío completed usa la misma ventana", () => {
      const completed = shipment({ status: ShipmentStatus.COMPLETED, deliveredAt: DELIVERED_AT });
      expect(access(completed, SENDER, new Date(DELIVERED_AT.getTime() + HOUR_MS))).toBe("open");
      expect(access(completed, SENDER, new Date(DELIVERED_AT.getTime() + 25 * HOUR_MS))).toBe("closed");
    });

    it("entregado sin deliveredAt (dato inconsistente) se trata como cerrado", () => {
      expect(access(shipment({ status: ShipmentStatus.DELIVERED, deliveredAt: null }), SENDER)).toBe("closed");
    });

    it("chatWindowDeadline es null mientras no se entregó", () => {
      expect(chatWindowDeadline(shipment())).toBeNull();
    });
  });

  it("un envío en disputa queda en solo lectura para las partes", () => {
    const disputed = shipment({ status: ShipmentStatus.DISPUTED, deliveredAt: DELIVERED_AT });
    expect(access(disputed, SENDER, new Date(DELIVERED_AT.getTime() + 500 * HOUR_MS))).toBe("read_only");
  });

  it("el receptor original (ADR-038) nunca escribe: solo lee mientras el chat esté abierto", () => {
    const s = shipment({ status: ShipmentStatus.IN_TRANSIT, formerReceiverId: FORMER_RECEIVER });
    expect(access(s, FORMER_RECEIVER)).toBe("read_only");
    const cancelled = shipment({ status: ShipmentStatus.CANCELLED, formerReceiverId: FORMER_RECEIVER });
    expect(access(cancelled, FORMER_RECEIVER)).toBe("closed");
  });

  it("el admin siempre puede leer, incluso con el chat cerrado, y nunca escribe", () => {
    const cancelled = shipment({ status: ShipmentStatus.CANCELLED });
    expect(access(cancelled, STRANGER, DELIVERED_AT, [UserRole.ADMIN])).toBe("read_only");
    const open = shipment({ status: ShipmentStatus.IN_TRANSIT });
    expect(access(open, STRANGER, DELIVERED_AT, [UserRole.ADMIN])).toBe("read_only");
  });

  it("un admin que además es parte del envío se rige por las reglas de las partes", () => {
    const open = shipment({ status: ShipmentStatus.IN_TRANSIT });
    expect(access(open, SENDER, DELIVERED_AT, [UserRole.ADMIN])).toBe("open");
  });
});
