import { describe, expect, it } from "vitest";
import {
  FORCED_TRANSITION_MATRIX,
  forcedTransitionFriction,
  getForcedTransition,
  getForcedTransitionDetails,
  ShipmentStatus,
} from "../src";

describe("forcedTransitionFriction (ADR-055)", () => {
  it("riesgo medio manual: sin código tipeado ni segundo factor", () => {
    const cell = getForcedTransition(ShipmentStatus.PUBLISHED, ShipmentStatus.CANCELLED)!;
    expect(forcedTransitionFriction(cell)).toEqual({ typedCode: false, stepUp: false });
  });

  it("riesgo medio forzado: segundo factor sin código tipeado", () => {
    const cell = getForcedTransition(ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.PUBLISHED)!;
    expect(forcedTransitionFriction(cell)).toEqual({ typedCode: false, stepUp: true });
  });

  it("riesgo alto manual: código tipeado sin segundo factor", () => {
    const cell = getForcedTransition(ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED)!;
    expect(forcedTransitionFriction(cell)).toEqual({ typedCode: true, stepUp: false });
  });

  it("riesgo alto forzado: las dos", () => {
    const cell = getForcedTransition(ShipmentStatus.ASSIGNED, ShipmentStatus.CANCELLED)!;
    expect(forcedTransitionFriction(cell)).toEqual({ typedCode: true, stepUp: true });
  });

  it("riesgo crítico: las dos aunque sea manual", () => {
    const cell = getForcedTransition(ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED)!;
    expect(cell.kind).toBe("manual");
    expect(forcedTransitionFriction(cell)).toEqual({ typedCode: true, stepUp: true });
  });
});

describe("getForcedTransitionDetails", () => {
  it("un par bloqueado no tiene detalles", () => {
    expect(getForcedTransitionDetails(ShipmentStatus.DISPUTED, ShipmentStatus.PUBLISHED)).toBeNull();
  });

  it("avisa al transportista solo si el envío tiene uno", () => {
    expect(getForcedTransitionDetails(ShipmentStatus.PUBLISHED, ShipmentStatus.CANCELLED)!.notifies).toEqual(["sender", "receiver"]);
    expect(getForcedTransitionDetails(ShipmentStatus.ASSIGNED, ShipmentStatus.CANCELLED)!.notifies).toEqual([
      "sender",
      "receiver",
      "carrier",
    ]);
  });

  it("pasar a assigned pide verificar el hold; cancelar y bajar al transportista avisan lo que no se deshace", () => {
    expect(getForcedTransitionDetails(ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED)!.checks).toEqual([
      expect.stringContaining("Mercado Pago"),
    ]);
    expect(getForcedTransitionDetails(ShipmentStatus.ASSIGNED, ShipmentStatus.CANCELLED)!.irreversible).toEqual([
      expect.stringContaining("terminal"),
    ]);
    expect(getForcedTransitionDetails(ShipmentStatus.ASSIGNED, ShipmentStatus.PUBLISHED)!.irreversible).toEqual([
      expect.stringContaining("volver a ofertar"),
    ]);
    expect(getForcedTransitionDetails(ShipmentStatus.DELIVERED, ShipmentStatus.COMPLETED)!.irreversible).toEqual([
      expect.stringContaining("reembolso"),
    ]);
  });

  it("toda celda describe sus efectos", () => {
    for (const [from, row] of Object.entries(FORCED_TRANSITION_MATRIX)) {
      for (const to of Object.keys(row)) {
        const details = getForcedTransitionDetails(from as ShipmentStatus, to as ShipmentStatus)!;
        expect(details.effects.length).toBeGreaterThan(0);
      }
    }
  });
});
