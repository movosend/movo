import { describe, expect, it } from "vitest";
import { OPERATIONS_CITY_ROWS, OPERATIONS_OTHER_CITIES, OPERATIONS_UNKNOWN_CITY } from "@movo/shared";
import { cancellationCauseOf, CancellationEventFacts, SANCTION_WITHDRAWAL_REASON } from "../src/domain/cancellation-cause";
import { OperationsFact, operationsReport } from "../src/domain/operations-report";

const RANGE = { from: "2026-10-01", to: "2026-10-02" };
const NOW = new Date("2026-10-03T12:00:00.000Z");
const IN_RANGE = "2026-10-01T15:00:00.000Z";
// Período anterior: 29 y 30 de septiembre.
const BEFORE = "2026-09-30T15:00:00.000Z";
const SENDER = "11111111-1111-1111-1111-111111111111";

const event = (overrides: Partial<CancellationEventFacts>): CancellationEventFacts => ({
  fromStatus: "published",
  actorId: SENDER,
  senderId: SENDER,
  kind: "normal",
  attribution: null,
  reason: null,
  ...overrides,
});

const fact = (overrides: Partial<OperationsFact>): OperationsFact => ({
  pickupCity: "Córdoba",
  publishedAt: IN_RANGE,
  firstCompletedAt: null,
  cancelledAt: null,
  cancelCause: null,
  demandRatio: null,
  highDemand: null,
  availableCarriers: null,
  ...overrides,
});

describe("causa de una cancelación (DD-059)", () => {
  it.each([
    ["el emisor", event({}), "sender"],
    ["el receptor no confirmó", event({ fromStatus: "awaiting_receiver_confirmation", actorId: null }), "receiver"],
    ["no se eligió otro receptor", event({ fromStatus: "rejected_by_receiver", actorId: null }), "receiver"],
    ["nadie retiró en la ventana publicada", event({ actorId: null }), "expired"],
    ["el transportista no se presentó", event({ fromStatus: "assigned", actorId: null, attribution: "carrier" }), "pickup_missed_carrier"],
    ["el retiro no se hizo sin culpa del transportista", event({ fromStatus: "assigned", actorId: null, attribution: "none" }), "pickup_missed_other"],
    ["la cuenta del emisor se suspendió", event({ reason: SANCTION_WITHDRAWAL_REASON }), "sanction"],
    ["un admin forzó el estado", event({ actorId: "admin", kind: "forced" }), "admin"],
    ["una disputa se resolvió a favor del emisor", event({ fromStatus: "disputed", actorId: "admin", kind: "manual" }), "dispute"],
    ["alguien que no es el emisor", event({ actorId: "otro" }), "other"],
  ])("%s", (_label, input, cause) => {
    expect(cancellationCauseOf(input)).toBe(cause);
  });
});

describe("reporte de Operación", () => {
  it("cuenta publicados, completados y cancelados cada uno por su fecha", () => {
    const report = operationsReport(
      [
        fact({ firstCompletedAt: IN_RANGE }),
        fact({ publishedAt: BEFORE, cancelledAt: IN_RANGE, cancelCause: "sender" }),
        fact({ publishedAt: BEFORE }),
      ],
      RANGE,
      NOW,
    );

    expect(report.kpis.published).toEqual({ value: 1, previous: 2 });
    expect(report.kpis.completed).toEqual({ value: 1, previous: 0 });
    expect(report.kpis.cancelled).toEqual({ value: 1, previous: 0 });
  });

  it("promedia la demanda solo sobre los envíos que la midieron", () => {
    const report = operationsReport(
      [
        fact({ demandRatio: 2, highDemand: true, availableCarriers: 1 }),
        fact({ demandRatio: 1, highDemand: false, availableCarriers: null }),
        fact({ demandRatio: null, highDemand: null }),
      ],
      RANGE,
      NOW,
    );

    expect(report.kpis.demandRatio.value).toBe(1.5);
    expect(report.kpis.highDemandRate.value).toBe(50);
    expect(report.kpis.availableCarriers.value).toBe(1);
  });

  it("sin mediciones la demanda es indefinida, no cero", () => {
    const report = operationsReport([fact({})], RANGE, NOW);

    expect(report.kpis.demandRatio.value).toBeNull();
    expect(report.kpis.highDemandRate.value).toBeNull();
    expect(report.kpis.availableCarriers.value).toBeNull();
  });

  it("desglosa las cancelaciones con todas las causas, aunque no tengan casos", () => {
    const report = operationsReport(
      [
        fact({ cancelledAt: IN_RANGE, cancelCause: "expired" }),
        fact({ cancelledAt: IN_RANGE, cancelCause: "expired" }),
        fact({ cancelledAt: IN_RANGE, cancelCause: "sender" }),
      ],
      RANGE,
      NOW,
    );
    const breakdown = report.breakdowns.find((candidate) => candidate.dimension === "cancelCause");

    expect(breakdown?.rows).toHaveLength(9);
    expect(breakdown?.rows[0]).toMatchObject({ key: "expired", value: 2, share: 66.67 });
    expect(breakdown?.rows[1]).toMatchObject({ key: "sender", value: 1 });
  });

  it("con ciudad mide solo esa, pero la lista del selector sigue trayendo todas", () => {
    const report = operationsReport([fact({}), fact({}), fact({ pickupCity: "Rosario" }), fact({ pickupCity: null })], RANGE, NOW, "Rosario");

    expect(report.city).toBe("Rosario");
    expect(report.kpis.published.value).toBe(1);
    expect(report.cities).toEqual([
      { city: "Córdoba", published: 2 },
      { city: "Rosario", published: 1 },
    ]);
  });

  it("agrupa las ciudades fuera del top y separa las que no tienen ciudad, sumando el total", () => {
    const facts = [
      ...Array.from({ length: OPERATIONS_CITY_ROWS + 2 }, (_, index) => fact({ pickupCity: `Ciudad ${String(index).padStart(2, "0")}` })),
      fact({ pickupCity: "Ciudad 00" }),
      fact({ pickupCity: null }),
      fact({ pickupCity: null }),
    ];
    const breakdown = operationsReport(facts, RANGE, NOW).breakdowns.find((candidate) => candidate.dimension === "city");
    const rows = breakdown?.rows ?? [];

    expect(rows).toHaveLength(OPERATIONS_CITY_ROWS + 1);
    expect(rows[0]).toMatchObject({ key: OPERATIONS_UNKNOWN_CITY, value: 2 });
    expect(rows.at(-1)?.key).toBe(OPERATIONS_OTHER_CITIES);
    expect(rows.reduce((total, row) => total + (row.value ?? 0), 0)).toBe(breakdown?.total.value);
  });
});
