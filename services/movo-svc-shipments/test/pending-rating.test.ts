import { describe, it, expect } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { computePendingRatingFor } from "../src/domain/pending-rating";
import { RatingRole } from "../src/models/rating";
import { ShipmentEvent } from "../src/models/shipment";

const SENDER_ID = "sender-id";
const RECEIVER_ID = "receiver-id";
const CARRIER_ID = "carrier-id";
const HOUR_MS = 60 * 60 * 1000;

const DELIVERED_AT = new Date("2030-01-05T00:00:00.000Z");
// Dentro de la ventana de 72hs (MOVO-146).
const WITHIN_WINDOW = new Date(DELIVERED_AT.getTime() + 1 * HOUR_MS);
// Pasadas las 72hs -- la ventana ya cerró.
const AFTER_WINDOW = new Date(DELIVERED_AT.getTime() + 73 * HOUR_MS);

type FakeShipment = {
  senderId: string;
  receiverId: string;
  carrierId: string | null;
  status: ShipmentStatus;
  deliveredAt: Date | null;
};

function fakeShipment(overrides: Partial<FakeShipment> = {}): FakeShipment {
  return {
    senderId: SENDER_ID,
    receiverId: RECEIVER_ID,
    carrierId: CARRIER_ID,
    status: ShipmentStatus.DELIVERED,
    deliveredAt: DELIVERED_AT,
    ...overrides,
  };
}

const NO_EVENTS: ShipmentEvent[] = [];
const NO_RATED_ROLES = new Set<RatingRole>();

describe("computePendingRatingFor (MOVO-222)", () => {
  it("emisor sin calificar todavía al transportista -- pendiente [carrier]", () => {
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, SENDER_ID, NO_RATED_ROLES, WITHIN_WINDOW);
    expect(result).toEqual([RatingRole.carrier]);
  });

  it("emisor que ya calificó al transportista -- sin pendientes", () => {
    const alreadyRated = new Set([RatingRole.carrier]);
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, SENDER_ID, alreadyRated, WITHIN_WINDOW);
    expect(result).toEqual([]);
  });

  it("receptor sin calificar todavía al transportista -- pendiente [carrier]", () => {
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, RECEIVER_ID, NO_RATED_ROLES, WITHIN_WINDOW);
    expect(result).toEqual([RatingRole.carrier]);
  });

  it("emisor y receptor NO se califican entre sí (regla de interacción física de MOVO-153)", () => {
    // El emisor nunca tiene pendiente calificar al receptor, sin importar si ya
    // calificó o no al transportista -- la regla nunca lo incluye como expected.
    const result = computePendingRatingFor(
      fakeShipment(),
      NO_EVENTS,
      SENDER_ID,
      new Set([RatingRole.carrier]),
      WITHIN_WINDOW,
    );
    expect(result).not.toContain(RatingRole.receiver);
  });

  it("transportista con 2 contrapartes sin calificar -- pendiente [sender, receiver]", () => {
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, CARRIER_ID, NO_RATED_ROLES, WITHIN_WINDOW);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([RatingRole.sender, RatingRole.receiver]));
  });

  it("DoD: transportista calificado PARCIALMENTE -- solo la contraparte que falta queda pendiente", () => {
    const ratedOnlySender = new Set([RatingRole.sender]);
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, CARRIER_ID, ratedOnlySender, WITHIN_WINDOW);
    expect(result).toEqual([RatingRole.receiver]);
  });

  it("transportista que ya calificó a ambas contrapartes -- sin pendientes", () => {
    const ratedBoth = new Set([RatingRole.sender, RatingRole.receiver]);
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, CARRIER_ID, ratedBoth, WITHIN_WINDOW);
    expect(result).toEqual([]);
  });

  it("DoD: envío todavía no delivered -- sin pendientes (no calificable)", () => {
    const shipment = fakeShipment({ status: ShipmentStatus.IN_TRANSIT, deliveredAt: null });
    const result = computePendingRatingFor(shipment, NO_EVENTS, SENDER_ID, NO_RATED_ROLES, WITHIN_WINDOW);
    expect(result).toEqual([]);
  });

  it("MOVO-208: completed (entregado Y pago liberado) también es calificable, igual que delivered", () => {
    const shipment = fakeShipment({ status: ShipmentStatus.COMPLETED });
    const result = computePendingRatingFor(shipment, NO_EVENTS, SENDER_ID, NO_RATED_ROLES, WITHIN_WINDOW);
    expect(result).toEqual([RatingRole.carrier]);
  });

  it("AC9: envío disputed -- sin pendientes (la disputa suspende la calificación)", () => {
    const shipment = fakeShipment({ status: ShipmentStatus.DISPUTED });
    const result = computePendingRatingFor(shipment, NO_EVENTS, SENDER_ID, NO_RATED_ROLES, WITHIN_WINDOW);
    expect(result).toEqual([]);
  });

  it("DoD: ventana de 72hs vencida -- sin pendientes", () => {
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, SENDER_ID, NO_RATED_ROLES, AFTER_WINDOW);
    expect(result).toEqual([]);
  });

  it("AC9: la ventana extendida por freeze de disputa sigue abierta más allá de las 72hs", () => {
    const events: ShipmentEvent[] = [
      {
        id: "e1",
        shipmentId: "s1",
        fromStatus: ShipmentStatus.DELIVERED,
        toStatus: ShipmentStatus.DISPUTED,
        actorId: null,
        reason: null,
        createdAt: new Date(DELIVERED_AT.getTime() + 10 * HOUR_MS),
      },
      {
        id: "e2",
        shipmentId: "s1",
        fromStatus: ShipmentStatus.DISPUTED,
        toStatus: ShipmentStatus.DELIVERED,
        actorId: null,
        reason: null,
        createdAt: new Date(DELIVERED_AT.getTime() + 34 * HOUR_MS), // 24hs congeladas
      },
    ];
    // 73hs desde la entrega -- ya vencería sin el freeze, sigue abierta con él.
    const result = computePendingRatingFor(fakeShipment(), events, SENDER_ID, NO_RATED_ROLES, AFTER_WINDOW);
    expect(result).toEqual([RatingRole.carrier]);
  });

  it("usuario que no participó del envío -- sin pendientes", () => {
    const result = computePendingRatingFor(fakeShipment(), NO_EVENTS, "ajeno-id", NO_RATED_ROLES, WITHIN_WINDOW);
    expect(result).toEqual([]);
  });
});
