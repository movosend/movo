import type { TransactionListItem, TransactionStatus } from "@movo/shared/dist/types/transaction";
import {
  dateRangeForPreset,
  dateRangeLabel,
  dayStringToPickerDate,
  formatDateTime,
  formatShortDate,
  formatTransactionAmount,
  groupTransactionsByMonth,
  matchingDatePreset,
  movementCopy,
  noResultsTitle,
  pickerDateToDayString,
  refundLine,
  resultsCountLabel,
  TRANSACTION_PILL_CLASSES,
  TRANSACTION_STATUS_ORDER,
  transactionCardLabel,
  transactionDisplayCode,
  transactionHeroLabel,
  transactionHeroPill,
  transactionRowSubtitle,
  transactionStatusLabel,
} from "../src/lib/transaction-format";

function item(overrides: Partial<TransactionListItem> = {}): TransactionListItem {
  return {
    id: "tx-1",
    shipmentId: "00000000-0000-4000-8000-000000048215",
    date: "2026-10-13T15:10:00.000Z",
    amountArs: 12450,
    status: "reserved",
    refundedAmountArs: null,
    card: { brand: "visa", last4: "4242" },
    ...overrides,
  };
}

// 17 oct 2026, 12:00 en Argentina.
const NOW = new Date("2026-10-17T15:00:00.000Z");

describe("transactionStatusLabel (MOVO-304 AC6/AC7)", () => {
  it("usa una única etiqueta por estado para quien paga", () => {
    expect(transactionStatusLabel("reserved", "sender")).toBe("Reservado");
    expect(transactionStatusLabel("completed", "sender")).toBe("Completado");
    expect(transactionStatusLabel("refunded", "sender")).toBe("Reembolsado");
    expect(transactionStatusLabel("disputed", "sender")).toBe("En disputa");
    expect(transactionStatusLabel("released", "sender")).toBe("Liberado");
  });

  it("en Cobros 'Completado' se muestra como 'Cobrado' y el resto no cambia", () => {
    expect(transactionStatusLabel("completed", "carrier")).toBe("Cobrado");
    for (const status of TRANSACTION_STATUS_ORDER.filter((s) => s !== "completed")) {
      expect(transactionStatusLabel(status, "carrier")).toBe(transactionStatusLabel(status, "sender"));
    }
  });

  it("hay estilo de pill para cada estado", () => {
    const statuses: TransactionStatus[] = ["reserved", "completed", "refunded", "disputed", "released"];
    for (const status of statuses) {
      expect(TRANSACTION_PILL_CLASSES[status].container).toBeTruthy();
      expect(TRANSACTION_PILL_CLASSES[status].text).toBeTruthy();
    }
    expect(TRANSACTION_PILL_CLASSES.reserved.container).toContain("bg-ink-950");
    expect(TRANSACTION_PILL_CLASSES.reserved.text).toContain("text-lime-500");
    expect(TRANSACTION_PILL_CLASSES.completed.container).toContain("bg-lime-500");
    expect(TRANSACTION_PILL_CLASSES.disputed.container).toContain("border-danger-600");
  });
});

describe("formateo de montos y referencias", () => {
  it("formatea con el helper de precio y nunca muestra NaN", () => {
    expect(formatTransactionAmount(12450)).toBe("$12.450");
    expect(formatTransactionAmount(Number.NaN)).toBe("—");
    expect(formatTransactionAmount(null)).toBe("—");
    expect(formatTransactionAmount(undefined)).toBe("—");
  });

  it("la referencia sale de activeShipmentDisplayCode (solo para mostrar)", () => {
    expect(transactionDisplayCode("00000000-0000-4000-8000-000000048215")).toBe("#MOVO-48215");
  });

  it("tarjeta: marca y últimos 4, o solo la marca si MP no informó los 4", () => {
    expect(transactionCardLabel({ brand: "visa", last4: "4242" })).toBe("Visa •••• 4242");
    expect(transactionCardLabel({ brand: "master", last4: "1881" })).toBe("Mastercard •••• 1881");
    expect(transactionCardLabel({ brand: "visa", last4: null })).toBe("Visa");
    expect(transactionCardLabel(null)).toBeNull();
    expect(transactionCardLabel(undefined)).toBeNull();
  });

  it("'Reembolso de $X' solo si hay monto devuelto", () => {
    expect(refundLine({ refundedAmountArs: 1500 })).toBe("Reembolso de $1.500");
    expect(refundLine({ refundedAmountArs: null })).toBeNull();
    expect(refundLine({ refundedAmountArs: Number.NaN })).toBeNull();
  });
});

describe("fechas en hora de Argentina (AC9)", () => {
  it("un pago de las 23:30 de Argentina queda en su día, aunque en UTC sea el siguiente", () => {
    // 2026-10-02T02:30Z = 1 oct 23:30 en Argentina.
    expect(formatShortDate("2026-10-02T02:30:00.000Z")).toBe("1 oct");
    expect(formatDateTime("2026-10-04T17:32:00.000Z")).toBe("4 oct 2026 · 14:32");
  });

  it("agrupa por mes argentino, del más reciente al más viejo, sumando páginas al mismo mes", () => {
    const sections = groupTransactionsByMonth([
      item({ id: "a", date: "2026-10-13T15:10:00.000Z" }),
      item({ id: "b", date: "2026-10-02T12:00:00.000Z" }),
      // 02:30 UTC del 1 de octubre es 23:30 del 30 de septiembre en Argentina: cuenta como septiembre.
      item({ id: "c", date: "2026-10-01T02:30:00.000Z" }),
      item({ id: "d", date: "2026-09-21T13:00:00.000Z" }),
    ]);
    expect(sections.map((s) => s.label)).toEqual(["Octubre 2026", "Septiembre 2026"]);
    expect(sections[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(sections[1].items.map((i) => i.id)).toEqual(["c", "d"]);
  });

  it("lista vacía no genera secciones", () => {
    expect(groupTransactionsByMonth([])).toEqual([]);
  });
});

describe("subtítulo de la fila (AC4)", () => {
  it("Pagos: tarjeta y fecha", () => {
    expect(transactionRowSubtitle(item(), "sender")).toBe("Visa •••• 4242 · 13 oct");
  });

  it("Pagos sin datos de tarjeta: solo la fecha", () => {
    expect(transactionRowSubtitle(item({ card: null }), "sender")).toBe("13 oct");
  });

  it("Cobros: la situación del cobro y la fecha, sin tarjeta", () => {
    expect(transactionRowSubtitle(item({ status: "reserved", card: undefined }), "carrier")).toBe(
      "Se acredita al entregar · 13 oct",
    );
    expect(transactionRowSubtitle(item({ status: "released", card: undefined }), "carrier")).toBe(
      "El envío se canceló · 13 oct",
    );
  });
});

describe("hero del detalle", () => {
  it("el transportista solo ve 'Te acreditaron' (el neto) cuando hay desglose", () => {
    expect(transactionHeroLabel("completed", "carrier", true)).toBe("Te acreditaron");
    expect(transactionHeroLabel("reserved", "carrier", false)).toBe("Pagó el emisor");
    expect(transactionHeroLabel("completed", "sender")).toBe("Pagaste");
    expect(transactionHeroLabel("released", "sender")).toBe("Reservaste");
  });

  it("un reembolso parcial lo aclara en la pill; uno total no", () => {
    expect(transactionHeroPill({ status: "refunded", refundedAmountArs: 1500, amountArs: 5200 }, "sender")).toBe(
      "Reembolsado parcialmente",
    );
    expect(transactionHeroPill({ status: "refunded", refundedAmountArs: 5200, amountArs: 5200 }, "sender")).toBe(
      "Reembolsado",
    );
    expect(transactionHeroPill({ status: "completed", refundedAmountArs: null, amountArs: 8900 }, "carrier")).toBe(
      "Cobrado",
    );
  });
});

describe("movimientos de la línea de tiempo (AC10)", () => {
  it("un reembolso parcial queda vinculado al pago original, con su monto", () => {
    const copy = movementCopy(
      { kind: "refund", amountArs: 1500, date: "2026-10-08T13:00:00.000Z" },
      5200,
      "2026-10-04T17:32:00.000Z",
    );
    expect(copy.title).toBe("Reembolso parcial");
    expect(copy.detail).toBe("8 oct · $1.500 devueltos a tu tarjeta");
    expect(copy.linkedNote).toBe("Vinculado al pago de $5.200 del 4 oct.");
  });

  it("un reembolso total no se llama parcial", () => {
    const copy = movementCopy(
      { kind: "refund", amountArs: 5200, date: "2026-10-08T13:00:00.000Z" },
      5200,
      "2026-10-04T17:32:00.000Z",
    );
    expect(copy.title).toBe("Reembolso");
  });

  it("un reembolso sin monto informado no inventa uno", () => {
    const copy = movementCopy(
      { kind: "refund", amountArs: null, date: "2026-10-08T13:00:00.000Z" },
      5200,
      "2026-10-04T17:32:00.000Z",
    );
    expect(copy.detail).not.toContain("$");
  });

  it("contracargo y mediación tienen su propio título", () => {
    expect(
      movementCopy({ kind: "chargeback", amountArs: 5200, date: "2026-10-08T13:00:00.000Z" }, 5200, "2026-10-04T17:32:00.000Z")
        .title,
    ).toBe("Contracargo");
    expect(
      movementCopy({ kind: "mediation", amountArs: null, date: "2026-10-08T13:00:00.000Z" }, 5200, "2026-10-04T17:32:00.000Z")
        .title,
    ).toBe("Mediación abierta");
  });
});

describe("atajos y rangos de fecha (AC8/AC9)", () => {
  it("calcula los atajos sobre el día calendario argentino", () => {
    expect(dateRangeForPreset("last30", NOW)).toEqual({ from: "2026-09-18", to: "2026-10-17" });
    expect(dateRangeForPreset("thisMonth", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-17" });
    expect(dateRangeForPreset("previousMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("'Mes anterior' en enero cruza al año anterior", () => {
    const january = new Date("2027-01-15T15:00:00.000Z");
    expect(dateRangeForPreset("previousMonth", january)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("a las 22:00 de Argentina del 31 el 'hoy' sigue siendo ese día aunque en UTC ya sea el 1", () => {
    const lateNight = new Date("2026-11-01T01:00:00.000Z"); // 31 oct 22:00 en Argentina
    expect(dateRangeForPreset("thisMonth", lateNight)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("detecta qué atajo coincide con el rango actual", () => {
    expect(matchingDatePreset("2026-10-01", "2026-10-17", NOW)).toBe("thisMonth");
    expect(matchingDatePreset("2026-09-01", "2026-09-30", NOW)).toBe("previousMonth");
    expect(matchingDatePreset("2026-10-05", "2026-10-17", NOW)).toBeNull();
    expect(matchingDatePreset(null, "2026-10-17", NOW)).toBeNull();
  });

  it("etiqueta del rango activo", () => {
    expect(dateRangeLabel("2026-10-01", "2026-10-14")).toBe("1 – 14 oct");
    expect(dateRangeLabel("2026-10-05", "2026-10-05")).toBe("5 oct");
    expect(dateRangeLabel("2026-09-18", "2026-10-17")).toBe("18 sep 2026 – 17 oct 2026");
    expect(dateRangeLabel("2026-10-01", null)).toBe("Desde 1 oct 2026");
    expect(dateRangeLabel(null, "2026-10-14")).toBe("Hasta 14 oct 2026");
    expect(dateRangeLabel(null, null)).toBeNull();
  });

  it("el selector nativo ida y vuelta no corre el día", () => {
    expect(pickerDateToDayString(dayStringToPickerDate("2026-10-01"))).toBe("2026-10-01");
    expect(pickerDateToDayString(dayStringToPickerDate("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("textos de lista", () => {
  it("contador: singular, plural y mínimo si hay más páginas", () => {
    expect(resultsCountLabel(1, "sender")).toBe("1 pago");
    expect(resultsCountLabel(6, "sender")).toBe("6 pagos");
    expect(resultsCountLabel(1, "carrier")).toBe("1 cobro");
    expect(resultsCountLabel(5, "carrier")).toBe("5 cobros");
    expect(resultsCountLabel(20, "sender", true)).toBe("20+ pagos");
  });

  it("título de 'sin resultados' por tab", () => {
    expect(noResultsTitle("sender")).toBe("Ningún pago coincide");
    expect(noResultsTitle("carrier")).toBe("Ningún cobro coincide");
  });
});
