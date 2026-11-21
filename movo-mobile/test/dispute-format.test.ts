import { DisputeReason, type ResolvedDisputeSummary } from "@movo/shared/dist/types/dispute";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentEvent } from "../src/api/shipments-client";
import {
  disputeExplanation,
  resolvedDisputeByEvent,
  disputeOutcomeText,
  disputeReasonShortLabel,
} from "../src/lib/dispute-format";

describe("dispute-format", () => {
  it("dice quién la abrió y por qué, desde el punto de vista de quien mira", () => {
    const bySender = { reason: DisputeReason.DAMAGED, openedByRole: "sender" as const };
    expect(disputeExplanation(bySender, "carrier")).toBe("La abrió el emisor porque el paquete llegó dañado.");
    expect(disputeExplanation(bySender, "sender")).toBe("La abriste vos porque el paquete llegó dañado.");
    // Quien no es parte vigente (el receptor que pasó la recepción) nunca la "abrió vos".
    expect(disputeExplanation({ reason: DisputeReason.DAMAGED, openedByRole: "carrier" }, null)).toBe(
      "La abrió el transportista porque el paquete llegó dañado.",
    );
    expect(disputeExplanation({ reason: DisputeReason.OTHER, openedByRole: "receiver" }, "sender")).toBe(
      "La abrió el receptor por otro motivo.",
    );
  });

  it("una disputa de sistema la abrió Movo", () => {
    expect(disputeExplanation({ reason: DisputeReason.TRANSIT_ANOMALY, openedByRole: null }, "carrier")).toBe(
      "La abrió Movo porque el envío quedó en camino más tiempo del esperado.",
    );
    expect(disputeExplanation({ reason: DisputeReason.PICKUP_NO_SHOW, openedByRole: null }, "sender")).toBe(
      "La abrió Movo porque el retiro no se concretó en el horario acordado.",
    );
  });

  describe("resolvedDisputeByEvent (MOVO-363)", () => {
    const S = ShipmentStatus;
    const ev = (id: string, from: ShipmentStatus | null, to: ShipmentStatus): ShipmentEvent => ({
      id,
      shipmentId: "s1",
      fromStatus: from,
      toStatus: to,
      actorId: null,
      reason: null,
      createdAt: "2026-11-18T14:00:00.000Z",
    });
    const dispute = (id: string, outcome: "sender" | "carrier" | "partial"): ResolvedDisputeSummary => ({
      id,
      reason: DisputeReason.DAMAGED,
      openedByRole: "sender",
      openedAt: "2026-11-18T14:00:00.000Z",
      outcome,
      resolvedAt: "2026-11-18T15:00:00.000Z",
    });

    it("empareja la apertura y la resolución de cada disputa, en orden", () => {
      const events = [ev("o1", S.ASSIGNED, S.DISPUTED), ev("r1", S.DISPUTED, S.COMPLETED), ev("o2", S.COMPLETED, S.DISPUTED), ev("r2", S.DISPUTED, S.CANCELLED)];
      const map = resolvedDisputeByEvent(events, [dispute("d1", "carrier"), dispute("d2", "sender")]);
      expect([...map].map(([eventId, d]) => [eventId, d.id])).toEqual([
        ["o1", "d1"],
        ["r1", "d1"],
        ["o2", "d2"],
        ["r2", "d2"],
      ]);
    });

    it("la apertura de una disputa que sigue abierta no queda emparejada con una resuelta", () => {
      const events = [ev("o1", S.ASSIGNED, S.DISPUTED), ev("r1", S.DISPUTED, S.COMPLETED), ev("o2", S.COMPLETED, S.DISPUTED)];
      const map = resolvedDisputeByEvent(events, [dispute("d1", "partial")]);
      expect(map.has("o2")).toBe(false);
      expect(map.get("o1")?.outcome).toBe("partial");
    });

    it("sin disputas resueltas no empareja nada", () => {
      const events = [ev("o1", S.ASSIGNED, S.DISPUTED), ev("r1", S.DISPUTED, S.COMPLETED)];
      expect(resolvedDisputeByEvent(events, undefined).size).toBe(0);
      expect(resolvedDisputeByEvent(events, []).size).toBe(0);
    });
  });

  it("el resultado visto por quien mira: el receptor nunca gana", () => {
    expect(disputeOutcomeText("carrier", "carrier")).toBe("Se resolvió a tu favor.");
    expect(disputeOutcomeText("carrier", "sender")).toBe("Se resolvió a favor del transportista.");
    expect(disputeOutcomeText("sender", "carrier")).toBe("Se resolvió a favor del emisor.");
    expect(disputeOutcomeText("sender", "receiver")).toBe("Se resolvió a favor del emisor.");
    expect(disputeOutcomeText("partial", "carrier")).toBe("Se resolvió con un acuerdo parcial.");
    expect(disputeOutcomeText(null, "sender")).toBe("Movo revisó el caso y cerró la disputa.");
  });

  it("motivo corto", () => {
    expect(disputeReasonShortLabel(DisputeReason.WRONG_DELIVERY)).toBe("Entrega equivocada");
  });
});
