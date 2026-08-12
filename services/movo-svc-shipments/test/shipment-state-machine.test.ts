import { describe, it, expect } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import {
  canTransition,
  transition,
  InvalidShipmentTransitionError,
  INITIAL_SHIPMENT_STATUS,
} from "../src/domain/shipment-state-machine";

const VALID_TRANSITIONS: Array<[ShipmentStatus, ShipmentStatus]> = [
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, ShipmentStatus.PUBLISHED],
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, ShipmentStatus.REJECTED_BY_RECEIVER],
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, ShipmentStatus.CANCELLED],
  [ShipmentStatus.PUBLISHED, ShipmentStatus.ASSIGNMENT_PENDING],
  [ShipmentStatus.PUBLISHED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.PUBLISHED],
  [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED],
  [ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.CANCELLED],
  [ShipmentStatus.ASSIGNED, ShipmentStatus.IN_TRANSIT],
  [ShipmentStatus.ASSIGNED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED],
  [ShipmentStatus.IN_TRANSIT, ShipmentStatus.DISPUTED],
  [ShipmentStatus.DELIVERED, ShipmentStatus.DISPUTED],
];

const INVALID_TRANSITIONS: Array<[ShipmentStatus, ShipmentStatus]> = [
  // saltea estados intermedios
  [ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION, ShipmentStatus.ASSIGNED],
  [ShipmentStatus.PUBLISHED, ShipmentStatus.IN_TRANSIT],
  // cancelación fuera de las transiciones del diagrama (in_transit ya no acepta cancelar)
  [ShipmentStatus.IN_TRANSIT, ShipmentStatus.CANCELLED],
  // desde un estado terminal
  [ShipmentStatus.CANCELLED, ShipmentStatus.PUBLISHED],
  [ShipmentStatus.REJECTED_BY_RECEIVER, ShipmentStatus.PUBLISHED],
  [ShipmentStatus.DISPUTED, ShipmentStatus.DELIVERED],
  // reversa de una transición válida
  [ShipmentStatus.DELIVERED, ShipmentStatus.IN_TRANSIT],
  // no-op: quedarse en el mismo estado no es una transición
  [ShipmentStatus.PUBLISHED, ShipmentStatus.PUBLISHED],
];

describe("shipment-state-machine", () => {
  it("el estado inicial es awaiting_receiver_confirmation", () => {
    expect(INITIAL_SHIPMENT_STATUS).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
  });

  describe("transiciones válidas (DTE completo, MOVO-105)", () => {
    it.each(VALID_TRANSITIONS)("%s -> %s", (from, to) => {
      expect(canTransition(from, to)).toBe(true);
      expect(transition(from, to)).toBe(to);
    });
  });

  describe("transiciones inválidas rechazadas", () => {
    it.each(INVALID_TRANSITIONS)("%s -> %s", (from, to) => {
      expect(canTransition(from, to)).toBe(false);
      expect(() => transition(from, to)).toThrow(InvalidShipmentTransitionError);
    });
  });

  it("el error identifica el estado de origen y destino rechazados", () => {
    try {
      transition(ShipmentStatus.CANCELLED, ShipmentStatus.PUBLISHED);
      expect.unreachable("transition debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidShipmentTransitionError);
      expect((error as InvalidShipmentTransitionError).from).toBe(ShipmentStatus.CANCELLED);
      expect((error as InvalidShipmentTransitionError).to).toBe(ShipmentStatus.PUBLISHED);
    }
  });

  it("todo estado no terminal tiene al menos una transición válida definida en el DTE", () => {
    const terminal = [ShipmentStatus.REJECTED_BY_RECEIVER, ShipmentStatus.CANCELLED, ShipmentStatus.DISPUTED];
    const nonTerminal = Object.values(ShipmentStatus).filter((status) => !terminal.includes(status));

    for (const status of nonTerminal) {
      const hasOutgoing = VALID_TRANSITIONS.some(([from]) => from === status);
      expect(hasOutgoing, `${status} debería tener al menos una transición de salida`).toBe(true);
    }
  });
});
