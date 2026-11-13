import { DisputeReason } from "@movo/shared/dist/types/dispute";
import { disputeExplanation, disputeReasonShortLabel } from "../src/lib/dispute-format";

describe("dispute-format", () => {
  it("dice quién la abrió y por qué, desde el punto de vista de quien mira", () => {
    const bySender = { reason: DisputeReason.DAMAGED, openedByRole: "sender" as const };
    expect(disputeExplanation(bySender, "carrier")).toBe("La abrió el emisor porque el paquete llegó dañado.");
    expect(disputeExplanation(bySender, "sender")).toBe("La abriste vos porque el paquete llegó dañado.");
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

  it("motivo corto", () => {
    expect(disputeReasonShortLabel(DisputeReason.WRONG_DELIVERY)).toBe("Entrega equivocada");
  });
});
