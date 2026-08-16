import { describe, it, expect } from "vitest";
import { OfferStatus } from "@movo/shared";
import {
  canTransition,
  transition,
  InvalidOfferTransitionError,
  INITIAL_OFFER_STATUS,
} from "../src/domain/offer-state-machine";

const VALID_TRANSITIONS: Array<[OfferStatus, OfferStatus]> = [
  [OfferStatus.PENDING, OfferStatus.ACCEPTED],
  [OfferStatus.PENDING, OfferStatus.REJECTED],
  [OfferStatus.PENDING, OfferStatus.WITHDRAWN],
  [OfferStatus.PENDING, OfferStatus.SUPERSEDED],
];

const INVALID_TRANSITIONS: Array<[OfferStatus, OfferStatus]> = [
  // `expired` es un estado derivado (AC11) — nunca alcanzable vía transition()
  [OfferStatus.PENDING, OfferStatus.EXPIRED],
  // reversa de una transición válida
  [OfferStatus.ACCEPTED, OfferStatus.PENDING],
  // desde un estado terminal
  [OfferStatus.REJECTED, OfferStatus.ACCEPTED],
  [OfferStatus.WITHDRAWN, OfferStatus.PENDING],
  [OfferStatus.SUPERSEDED, OfferStatus.WITHDRAWN],
  [OfferStatus.EXPIRED, OfferStatus.PENDING],
  // no-op: quedarse en el mismo estado no es una transición
  [OfferStatus.PENDING, OfferStatus.PENDING],
];

describe("offer-state-machine", () => {
  it("el estado inicial es pending", () => {
    expect(INITIAL_OFFER_STATUS).toBe(OfferStatus.PENDING);
  });

  describe("transiciones válidas (DTE completo, MOVO-102)", () => {
    it.each(VALID_TRANSITIONS)("%s -> %s", (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(transition(from, to)).toBe(to);
    });
  });

  describe("transiciones inválidas rechazadas", () => {
    it.each(INVALID_TRANSITIONS)("%s -> %s", (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => transition(from, to)).toThrow(InvalidOfferTransitionError);
    });
  });

  it("el error identifica el estado de origen y destino rechazados", () => {
    try {
      transition(OfferStatus.REJECTED, OfferStatus.ACCEPTED);
      expect.unreachable("transition debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOfferTransitionError);
      expect((error as InvalidOfferTransitionError).from).toBe(OfferStatus.REJECTED);
      expect((error as InvalidOfferTransitionError).to).toBe(OfferStatus.ACCEPTED);
    }
  });

  it("todo estado no terminal tiene al menos una transición válida definida en el DTE", () => {
    const terminal = [
      OfferStatus.ACCEPTED,
      OfferStatus.REJECTED,
      OfferStatus.WITHDRAWN,
      OfferStatus.EXPIRED,
      OfferStatus.SUPERSEDED,
    ];
    const nonTerminal = Object.values(OfferStatus).filter((status) => !terminal.includes(status));

    for (const status of nonTerminal) {
      const hasOutgoing = VALID_TRANSITIONS.some(([from]) => from === status);
      expect(hasOutgoing, `${status} debería tener al menos una transición de salida`).toBe(true);
    }
  });
});
