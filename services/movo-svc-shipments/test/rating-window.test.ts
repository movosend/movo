import { describe, it, expect } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { computeRatingWindowDeadline, isRatingWindowOpen, RATING_WINDOW_HOURS } from "../src/domain/rating-window";
import { ShipmentEvent } from "../src/models/shipment";

const HOUR_MS = 60 * 60 * 1000;

function fakeEvent(overrides: Partial<ShipmentEvent> = {}): ShipmentEvent {
  return {
    id: "event-id",
    shipmentId: "shipment-id",
    fromStatus: null,
    toStatus: ShipmentStatus.DELIVERED,
    actorId: null,
    reason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("computeRatingWindowDeadline / isRatingWindowOpen (MOVO-146 AC8/AC9)", () => {
  const deliveredAt = new Date("2030-01-01T00:00:00.000Z");

  it("AC8: sin eventos de disputa, el deadline es exactamente deliveredAt + 72hs", () => {
    const deadline = computeRatingWindowDeadline(deliveredAt, []);
    expect(deadline.getTime()).toBe(deliveredAt.getTime() + RATING_WINDOW_HOURS * HOUR_MS);
  });

  it("la ventana sigue abierta un instante antes del deadline", () => {
    const justBefore = new Date(deliveredAt.getTime() + RATING_WINDOW_HOURS * HOUR_MS - 1);
    expect(isRatingWindowOpen(deliveredAt, [], justBefore)).toBe(true);
  });

  it("la ventana cierra en el instante exacto del deadline (inclusive)", () => {
    const exact = new Date(deliveredAt.getTime() + RATING_WINDOW_HOURS * HOUR_MS);
    expect(isRatingWindowOpen(deliveredAt, [], exact)).toBe(true);
  });

  it("la ventana está cerrada un instante después del deadline", () => {
    const justAfter = new Date(deliveredAt.getTime() + RATING_WINDOW_HOURS * HOUR_MS + 1);
    expect(isRatingWindowOpen(deliveredAt, [], justAfter)).toBe(false);
  });

  it("AC9: un período completo en disputed extiende el deadline por su duración", () => {
    const disputeEnteredAt = new Date(deliveredAt.getTime() + 10 * HOUR_MS);
    const disputeExitedAt = new Date(deliveredAt.getTime() + 34 * HOUR_MS); // 24hs en disputa
    const events = [
      fakeEvent({ fromStatus: ShipmentStatus.DELIVERED, toStatus: ShipmentStatus.DISPUTED, createdAt: disputeEnteredAt }),
      fakeEvent({ fromStatus: ShipmentStatus.DISPUTED, toStatus: ShipmentStatus.DELIVERED, createdAt: disputeExitedAt }),
    ];

    const deadline = computeRatingWindowDeadline(deliveredAt, events);
    expect(deadline.getTime()).toBe(deliveredAt.getTime() + RATING_WINDOW_HOURS * HOUR_MS + 24 * HOUR_MS);
  });

  it("AC9: una disputa todavía abierta (sin evento de salida) no cuenta como tiempo congelado ya consumido", () => {
    const disputeEnteredAt = new Date(deliveredAt.getTime() + 10 * HOUR_MS);
    const events = [
      fakeEvent({ fromStatus: ShipmentStatus.DELIVERED, toStatus: ShipmentStatus.DISPUTED, createdAt: disputeEnteredAt }),
    ];

    // Sin salida modelada todavía (MOVO-105): el período abierto no suma nada al
    // deadline -- lo que bloquea calificar mientras tanto es el chequeo de
    // `status === disputed` en ratings.service.ts, no este cálculo.
    const deadline = computeRatingWindowDeadline(deliveredAt, events);
    expect(deadline.getTime()).toBe(deliveredAt.getTime() + RATING_WINDOW_HOURS * HOUR_MS);
  });

  it("AC9: dos disputas separadas acumulan su duración total", () => {
    const events = [
      fakeEvent({
        fromStatus: ShipmentStatus.DELIVERED,
        toStatus: ShipmentStatus.DISPUTED,
        createdAt: new Date(deliveredAt.getTime() + 5 * HOUR_MS),
      }),
      fakeEvent({
        fromStatus: ShipmentStatus.DISPUTED,
        toStatus: ShipmentStatus.DELIVERED,
        createdAt: new Date(deliveredAt.getTime() + 15 * HOUR_MS), // 10hs
      }),
      fakeEvent({
        fromStatus: ShipmentStatus.DELIVERED,
        toStatus: ShipmentStatus.DISPUTED,
        createdAt: new Date(deliveredAt.getTime() + 20 * HOUR_MS),
      }),
      fakeEvent({
        fromStatus: ShipmentStatus.DISPUTED,
        toStatus: ShipmentStatus.DELIVERED,
        createdAt: new Date(deliveredAt.getTime() + 26 * HOUR_MS), // 6hs
      }),
    ];

    const deadline = computeRatingWindowDeadline(deliveredAt, events);
    expect(deadline.getTime()).toBe(deliveredAt.getTime() + RATING_WINDOW_HOURS * HOUR_MS + 16 * HOUR_MS);
  });
});
