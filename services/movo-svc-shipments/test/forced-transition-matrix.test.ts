import { describe, expect, it } from "vitest";
import {
  blockedTransitionReason,
  FORCED_TRANSITION_MATRIX,
  getForcedTransition,
  listForcedTransitionTargets,
  ShipmentStatus,
} from "@movo/shared";
import { canTransition } from "../src/domain/shipment-state-machine";

/** MOVO-331 (ADR-055): la matriz de `@movo/shared` contra la máquina de estados del servicio. */
const ALL = Object.values(ShipmentStatus);
const cells = ALL.flatMap((from) =>
  listForcedTransitionTargets(from).map((to) => ({ from, to, cell: getForcedTransition(from, to)! })),
);

describe("FORCED_TRANSITION_MATRIX (ADR-055)", () => {
  it("tiene una fila por cada estado", () => {
    expect(Object.keys(FORCED_TRANSITION_MATRIX).sort()).toEqual([...ALL].sort());
  });

  it.each(cells.map((c) => [c.from, c.to] as const))("%s -> %s es una arista de la máquina de estados", (from, to) => {
    // Todo lo que se fuerza es una arista que ya existe: un par sin servicio de dominio no se inventa.
    expect(canTransition(from, to)).toBe(true);
  });

  it("completed, cancelled, disputed e in_transit no tienen ninguna salida forzada", () => {
    for (const from of [ShipmentStatus.COMPLETED, ShipmentStatus.CANCELLED, ShipmentStatus.DISPUTED, ShipmentStatus.IN_TRANSIT]) {
      expect(listForcedTransitionTargets(from)).toEqual([]);
    }
  });

  it("ninguna celda entra a disputed, in_transit ni delivered", () => {
    const blockedTargets = [ShipmentStatus.DISPUTED, ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED];
    expect(cells.filter((c) => blockedTargets.includes(c.to))).toEqual([]);
  });

  it("las salidas forzadas con penalidad condonada son forced y exigen servicio de baja o cancelación", () => {
    expect(getForcedTransition(ShipmentStatus.ASSIGNED, ShipmentStatus.CANCELLED)).toMatchObject({ kind: "forced" });
    expect(getForcedTransition(ShipmentStatus.ASSIGNED, ShipmentStatus.PUBLISHED)).toMatchObject({
      kind: "forced",
      service: "withdrawCarrierFromShipment",
    });
  });

  it("dar por asignado se ejecuta con el servicio que consulta el hold; ninguna otra celda pasa a assigned", () => {
    const toAssigned = cells.filter((c) => c.to === ShipmentStatus.ASSIGNED);
    expect(toAssigned.length).toBeGreaterThan(0);
    expect(toAssigned.every((c) => c.cell.service === "confirmFunding")).toBe(true);
    expect(cells.filter((c) => c.cell.service === "confirmFunding").every((c) => c.to === ShipmentStatus.ASSIGNED)).toBe(true);
  });

  it("todo par bloqueado tiene un motivo legible", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        if (getForcedTransition(from, to)) continue;
        expect(blockedTransitionReason(from, to).length).toBeGreaterThan(10);
      }
    }
  });
});
