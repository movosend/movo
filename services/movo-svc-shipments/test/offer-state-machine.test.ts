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
  // MOVO-258 (D7): el envío se cancela con la oferta vigente o ya aceptada
  [OfferStatus.PENDING, OfferStatus.SHIPMENT_CANCELLED],
  [OfferStatus.ACCEPTED, OfferStatus.SHIPMENT_CANCELLED],
  // MOVO-210: aceptada pero la asignación no prosperó (pago no completado o hold perdido)
  [OfferStatus.ACCEPTED, OfferStatus.ASSIGNMENT_LAPSED],
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
  [OfferStatus.SHIPMENT_CANCELLED, OfferStatus.PENDING],
  [OfferStatus.SHIPMENT_CANCELLED, OfferStatus.ACCEPTED],
  // `assignment_lapsed` es terminal; y una oferta que nunca se aceptó no puede "caerse"
  [OfferStatus.ASSIGNMENT_LAPSED, OfferStatus.ACCEPTED],
  [OfferStatus.PENDING, OfferStatus.ASSIGNMENT_LAPSED],
  // aceptada ya no se reetiqueta como rechazada: el emisor no la rechazó
  [OfferStatus.ACCEPTED, OfferStatus.REJECTED],
  // una oferta rechazada/retirada/superada no se reetiqueta al cancelarse el envío
  [OfferStatus.REJECTED, OfferStatus.SHIPMENT_CANCELLED],
  [OfferStatus.WITHDRAWN, OfferStatus.SHIPMENT_CANCELLED],
  [OfferStatus.SUPERSEDED, OfferStatus.SHIPMENT_CANCELLED],
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
      OfferStatus.SHIPMENT_CANCELLED,
      OfferStatus.ASSIGNMENT_LAPSED,
    ];
    const nonTerminal = Object.values(OfferStatus).filter((status) => !terminal.includes(status));

    for (const status of nonTerminal) {
      const hasOutgoing = VALID_TRANSITIONS.some(([from]) => from === status);
      expect(hasOutgoing, `${status} debería tener al menos una transición de salida`).toBe(true);
    }
  });
});
