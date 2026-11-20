import { DisputeReason } from "@movo/shared/dist/types/dispute";
import {
  disputeExplanation,
  disputeOutcomeFromReason,
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

  it("lee el resultado del motivo que escribe svc-shipments al resolver", () => {
    expect(disputeOutcomeFromReason("Disputa resuelta a favor del emisor")).toBe("sender");
    expect(disputeOutcomeFromReason("Disputa resuelta a favor del transportista")).toBe("carrier");
    expect(disputeOutcomeFromReason("Disputa resuelta con un resultado parcial")).toBe("partial");
    expect(disputeOutcomeFromReason("Cambio forzado desde el panel")).toBeNull();
    expect(disputeOutcomeFromReason(null)).toBeNull();
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
