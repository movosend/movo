import type { ShipmentFundingView } from "@movo/shared/dist/types/funding";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentSummary } from "../src/api/shipments-client";
import {
  FUNDING_PROCESSING_POLL_MS,
  failureReasonCopy,
  formatFundingCard,
  formatFundingDeadline,
  fundingProcessingPollInterval,
  fundsStatusVariant,
  lapseReasonCopy,
} from "../src/lib/funds-status-format";

const PAY_UNTIL = "2026-10-08T13:00:00.000Z";

function due(overrides: Partial<Extract<ShipmentFundingView, { phase: "payment_due" }>> = {}): ShipmentFundingView {
  return {
    viewer: "sender",
    phase: "payment_due",
    route: "far",
    payUntil: PAY_UNTIL,
    amountArs: 18400,
    lastAttempt: "none",
    failureReason: null,
    card: null,
    holdLost: false,
    ...overrides,
  };
}

describe("fundsStatusVariant (MOVO-211)", () => {
  it("sin funding no hay card", () => {
    expect(fundsStatusVariant(null, ShipmentStatus.ASSIGNED)).toBeNull();
    expect(fundsStatusVariant(undefined, ShipmentStatus.ASSIGNED)).toBeNull();
  });

  it("mapea las fases del emisor a su variante", () => {
    expect(
      fundsStatusVariant(
        { viewer: "sender", phase: "awaiting_window", windowOpensAt: PAY_UNTIL, payUntil: PAY_UNTIL, amountArs: 1 },
        ShipmentStatus.ASSIGNED_UNFUNDED,
      ),
    ).toBe("awaiting_window");
    expect(fundsStatusVariant(due(), ShipmentStatus.ASSIGNED_UNFUNDED)).toBe("confirm");
    expect(fundsStatusVariant(due({ route: "near" }), ShipmentStatus.ASSIGNMENT_PENDING)).toBe("unfinished");
    expect(fundsStatusVariant(due({ lastAttempt: "in_process" }), ShipmentStatus.ASSIGNMENT_PENDING)).toBe(
      "processing",
    );
    expect(fundsStatusVariant(due({ lastAttempt: "rejected" }), ShipmentStatus.ASSIGNMENT_PENDING)).toBe("rejected");
    // payments no respondió: el estado genérico de confirmar, que siempre es cierto.
    expect(fundsStatusVariant(due({ route: "near", lastAttempt: null }), ShipmentStatus.ASSIGNMENT_PENDING)).toBe(
      "confirm",
    );
  });

  it("la reserva retenida distingue asignado, en camino y entregado", () => {
    const held: ShipmentFundingView = { viewer: "sender", phase: "held", amountArs: 1, card: null };
    expect(fundsStatusVariant(held, ShipmentStatus.ASSIGNED)).toBe("held");
    expect(fundsStatusVariant(held, ShipmentStatus.IN_TRANSIT)).toBe("held_in_transit");
    expect(fundsStatusVariant(held, ShipmentStatus.DELIVERED)).toBe("held_delivered");
  });

  it("cobrada, liberada y vencida", () => {
    expect(fundsStatusVariant({ viewer: "sender", phase: "captured", amountArs: 1, at: PAY_UNTIL }, ShipmentStatus.COMPLETED)).toBe(
      "captured",
    );
    expect(fundsStatusVariant({ viewer: "sender", phase: "released", amountArs: 1 }, ShipmentStatus.CANCELLED)).toBe(
      "released",
    );
    expect(
      fundsStatusVariant({ viewer: "sender", phase: "lapsed", reason: "payment_timeout", at: PAY_UNTIL }, ShipmentStatus.PUBLISHED),
    ).toBe("lapsed");
  });

  it("variantes del transportista", () => {
    expect(fundsStatusVariant({ viewer: "carrier", phase: "held" }, ShipmentStatus.ASSIGNED)).toBe("carrier_held");
    expect(
      fundsStatusVariant({ viewer: "carrier", phase: "sender_payment_pending", payUntil: PAY_UNTIL }, ShipmentStatus.ASSIGNED_UNFUNDED),
    ).toBe("carrier_pending");
    expect(
      fundsStatusVariant({ viewer: "former_carrier", phase: "lapsed", reason: "window_expired", at: PAY_UNTIL }, ShipmentStatus.PUBLISHED),
    ).toBe("carrier_lapsed");
  });

});

describe("formatFundingDeadline", () => {
  it("día corto y hora en Argentina", () => {
    // 13:00 UTC = 10:00 en Argentina, jueves 8 de octubre.
    expect(formatFundingDeadline(PAY_UNTIL, new Date("2026-10-01T12:00:00.000Z"))).toBe("el jue 8 oct a las 10:00 h");
  });

  it("hoy y mañana en minúscula", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    expect(formatFundingDeadline(PAY_UNTIL, now)).toBe("hoy a las 10:00 h");
    expect(formatFundingDeadline("2026-10-09T21:30:00.000Z", now)).toBe("mañana a las 18:30 h");
  });

  it("un instante de madrugada UTC cae el día anterior en Argentina", () => {
    expect(formatFundingDeadline("2026-10-09T01:00:00.000Z", new Date("2026-10-01T12:00:00.000Z"))).toBe(
      "el jue 8 oct a las 22:00 h",
    );
  });
});

describe("copy", () => {
  it("cada motivo de rechazo tiene su título (AC5)", () => {
    expect(failureReasonCopy("insufficient_funds").title).toMatch(/fondos suficientes/);
    expect(failureReasonCopy("card_rejected").title).toMatch(/rechazó la tarjeta/);
    expect(failureReasonCopy("invalid_data").title).toMatch(/no coinciden/);
    expect(failureReasonCopy("platform_error").title).toMatch(/No pudimos procesar/);
  });

  it("por qué volvió a publicarse, para emisor y transportista (AC6)", () => {
    expect(lapseReasonCopy("window_expired", "sender")).toMatch(/No confirmaste el pago a tiempo, así que el transportista/);
    expect(lapseReasonCopy("payment_timeout", "sender")).toMatch(/no se completó a tiempo, así que el transportista/);
    expect(lapseReasonCopy("window_expired", "carrier")).toBe("El emisor no confirmó el pago antes del plazo.");
    expect(lapseReasonCopy("payment_timeout", "carrier")).toBe("El pago del emisor no se completó a tiempo.");
  });

  it("ningún copy del rechazo o la vuelta a publicar afirma un cobro (AC7)", () => {
    const texts = [
      ...(["insufficient_funds", "card_rejected", "invalid_data", "platform_error"] as const).flatMap((r) => {
        const c = failureReasonCopy(r);
        return [c.title, c.body];
      }),
      lapseReasonCopy("window_expired", "sender"),
      lapseReasonCopy("payment_timeout", "sender"),
    ];
    for (const text of texts) expect(text).not.toMatch(/se (te )?cobr[óo]|debitamos|te cobramos/i);
  });

  it("formatea la tarjeta con el nombre de la marca", () => {
    expect(formatFundingCard({ brand: "visa", lastFour: "3704" })).toBe("Visa •••• 3704");
    expect(formatFundingCard({ brand: "master", lastFour: "1111" })).toBe("Mastercard •••• 1111");
    expect(formatFundingCard({ brand: "nuevamarca", lastFour: "0000" })).toBe("Nuevamarca •••• 0000");
  });
});

describe("fundingProcessingPollInterval", () => {
  it("consulta seguido solo mientras MP revisa el pago del emisor", () => {
    const base = { status: ShipmentStatus.ASSIGNMENT_PENDING } as ShipmentSummary;
    expect(fundingProcessingPollInterval({ ...base, funding: due({ lastAttempt: "in_process" }) })).toBe(
      FUNDING_PROCESSING_POLL_MS,
    );
    expect(fundingProcessingPollInterval({ ...base, funding: due() })).toBe(false);
    expect(fundingProcessingPollInterval({ ...base, funding: null })).toBe(false);
    expect(fundingProcessingPollInterval(undefined)).toBe(false);
  });
});
