import {
  buildReportBody,
  CAPTURE_LEAKAGE_STEPS,
  CaptureAmounts,
  CaptureLeakage,
  CaptureLeakageStep,
  CASHFLOW_KPIS,
  CashflowReport,
  DISTANCE_BANDS,
  DistanceBand,
  getCommissionConfig,
  GmvBridge,
  isInReportRange,
  PaymentReportFact,
  previousReportRange,
  PRICE_COMPONENTS,
  PriceComponent,
  PRICING_KPIS,
  PricingReport,
  QuoteBreakdown,
  ReportBreakdown,
  reportBuckets,
  ReportRange,
  reportRate,
  reportRound,
  ReportSource,
  ShipmentReportFact,
} from "@movo/shared";

/** Lo que sigue su curso: todavía puede capturarse (DD-059). */
const TIMING_STEPS: ReadonlySet<CaptureLeakageStep> = new Set(["pending_capture", "in_flight"]);
/**
 * Los estados donde la cascada ya puede ubicar al envío. El resto va a `in_flight`, también `disputed` y
 * `rejected_by_receiver`: ninguno es terminal y la plata todavía puede terminar capturada (DD-059).
 */
const SETTLED_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled", "delivered"]);

export type PaymentFactsById = ReadonlyMap<string, PaymentReportFact>;

const sumOf = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const toCents = (ars: number): number => Math.round(ars * 100);
const fromCents = (cents: number): number => cents / 100;

const completedIn = (facts: readonly ShipmentReportFact[], range: ReportRange) =>
  facts.filter((fact) => fact.agreedPriceArs !== null && isInReportRange(fact.firstCompletedAt, range));
const gmvOf = (facts: readonly ShipmentReportFact[]): number => sumOf(facts.map((fact) => fact.agreedPriceArs ?? 0));
const ticketOf = (facts: readonly ShipmentReportFact[]): number | null => (facts.length === 0 ? null : gmvOf(facts) / facts.length);
const roundedOrNull = (value: number | null): number | null => (value === null ? null : reportRound(value));

/**
 * La comisión del envío: la capturada con tarjeta o la devengada en efectivo, aunque siga como deuda (DD-059). `null` si
 * todavía no hay ninguna: un settlement sin acreditar guarda la comisión que se espera cobrar, no una cobrada.
 */
const commissionOf = (fact: ShipmentReportFact, payments: PaymentFactsById): number | null => {
  const payment = payments.get(fact.shipmentId);
  if (payment?.settlementStatus === "credited" && payment.commissionArs !== null) return payment.commissionArs;
  return payment?.cashCommissionArs ?? null;
};

export function cashflowReport(
  facts: readonly ShipmentReportFact[],
  payments: PaymentFactsById,
  range: ReportRange,
  now: Date,
): ReportSource<CashflowReport> {
  const body = buildReportBody(
    range,
    CASHFLOW_KPIS,
    (period) => {
      const completed = completedIn(facts, period);
      const gmv = gmvOf(completed);
      const earned = completed.flatMap((fact) => {
        const commission = commissionOf(fact, payments);
        return commission === null ? [] : [{ commission, gmv: fact.agreedPriceArs ?? 0 }];
      });
      const commission = sumOf(earned.map((row) => row.commission));
      // Sobre el GMV de los envíos con comisión: uno sin capturar no la baja.
      const earnedGmv = sumOf(earned.map((row) => row.gmv));
      return {
        gmv: reportRound(gmv),
        completed: completed.length,
        avgTicket: roundedOrNull(ticketOf(completed)),
        commission: reportRound(commission),
        takeRate: earnedGmv === 0 ? null : reportRate(commission, earnedGmv),
      };
    },
    now,
  );
  const pending = facts.filter(
    (fact) => fact.status === "delivered" && isInReportRange(fact.deliveredAt, range) && payments.get(fact.shipmentId)?.settlementStatus === "processing",
  );
  const pendingCapture = {
    count: pending.length,
    amountArs: reportRound(sumOf(pending.map((fact) => payments.get(fact.shipmentId)?.capturedArs ?? fact.agreedPriceArs ?? 0))),
  };
  return { ...body, breakdowns: [bandBreakdown(facts, range, "gmv", gmvOf)], pendingCapture };
}

function bandBreakdown(
  facts: readonly ShipmentReportFact[],
  range: ReportRange,
  metric: "gmv" | "completed",
  valueOf: (rows: readonly ShipmentReportFact[]) => number,
): ReportBreakdown {
  const previous = previousReportRange(range);
  const inBand = (band: DistanceBand, period: ReportRange) => completedIn(facts, period).filter((fact) => fact.band === band);
  // El total son los envíos con tramo: uno sin distancia guardada (`band` null) no tiene fila, y si entrara en el total las
  // filas no sumarían ni el 100 %. Los KPI del reporte sí lo cuentan.
  const banded = (period: ReportRange) => DISTANCE_BANDS.flatMap((band) => inBand(band, period));
  const total = reportRound(valueOf(banded(range)));
  return {
    dimension: "band",
    metric,
    total: { value: total, previous: reportRound(valueOf(banded(previous))) },
    rows: DISTANCE_BANDS.map((key) => {
      const rows = inBand(key, range);
      const value = reportRound(valueOf(rows));
      return {
        key,
        value,
        previous: reportRound(valueOf(inBand(key, previous))),
        share: reportRate(value, total),
        extra: { avgTicket: roundedOrNull(ticketOf(rows)) },
      };
    }),
  };
}

interface LeakageEntry {
  key: CaptureLeakageStep;
  gmvCents: number;
  commissionCents: number;
}

/** Lo cotizado es el precio acordado si lo hubo, para que la cascada cierre: la negociación se mide en el puente. */
const quotedOf = (fact: ShipmentReportFact): number | null => fact.agreedPriceArs ?? fact.suggestedPriceArs;

function quotedCommissionCents(fact: ShipmentReportFact, payment: PaymentReportFact | undefined, quotedCents: number): number {
  const known = payment?.commissionArs ?? payment?.cashCommissionArs ?? payment?.holdCommissionArs;
  return known !== null && known !== undefined ? toCents(known) : Math.round(quotedCents * getCommissionConfig().movoCommissionRate);
}

/**
 * Hasta dónde llegó un envío, en un solo paso (DD-059). `null`: se capturó entero. El resto de lo cotizado siempre queda
 * capturado, así que la cascada cierra por construcción.
 */
export function classifyLeakage(fact: ShipmentReportFact, payment: PaymentReportFact | undefined, quotedCents: number, commissionCents: number): LeakageEntry | null {
  const all = (key: CaptureLeakageStep): LeakageEntry => ({ key, gmvCents: quotedCents, commissionCents });
  const refundedCents = toCents(payment?.refundedArs ?? 0);

  if (!SETTLED_STATUSES.has(fact.status)) return all("in_flight");

  if (fact.status === "delivered") {
    const failed = payment?.settlementStatus === "failed" || payment?.settlementStatus === "escalated";
    return all(failed ? "capture_failed" : "pending_capture");
  }

  if (fact.status === "cancelled") {
    if (refundedCents > 0) return all("dispute_refund");
    if (payment?.settlementStatus === "failed" || payment?.settlementStatus === "escalated") return all("capture_failed");
    if (payment?.holdExpired) return all("hold_expired");
    if (payment?.holdRejected) return all("payment_failed");
    if (fact.firstAssignedAt !== null) return all("cancelled");
    return all(fact.cancelledBySystem ? "unassigned" : "cancelled");
  }

  // Completado.
  if (payment?.cashCommissionArs !== null && payment?.cashCommissionArs !== undefined) {
    return payment.cashCommissionDebtOpen ? { key: "cash_commission_debt", gmvCents: 0, commissionCents } : null;
  }
  const capturedCents = payment?.capturedArs === null || payment?.capturedArs === undefined ? quotedCents : toCents(payment.capturedArs);
  const lostCents = Math.max(quotedCents - capturedCents, 0) + refundedCents;
  if (lostCents === 0) return null;
  const gmvCents = Math.min(lostCents, quotedCents);
  return { key: "dispute_refund", gmvCents, commissionCents: quotedCents === 0 ? 0 : Math.round((commissionCents * gmvCents) / quotedCents) };
}

interface LeakageTotals {
  leakage: CaptureLeakage;
  captureRate: number | null;
}

export function captureLeakage(facts: readonly ShipmentReportFact[], payments: PaymentFactsById, range: ReportRange): LeakageTotals | null {
  const cohort = facts.filter((fact) => quotedOf(fact) !== null && isInReportRange(fact.publishedAt, range));
  if (cohort.length === 0) return null;

  let quotedGmv = 0;
  let quotedCommission = 0;
  let capturedCount = 0;
  const steps = new Map<CaptureLeakageStep, { shipments: number; gmvCents: number; commissionCents: number }>(
    CAPTURE_LEAKAGE_STEPS.map((key) => [key, { shipments: 0, gmvCents: 0, commissionCents: 0 }]),
  );
  for (const fact of cohort) {
    const payment = payments.get(fact.shipmentId);
    const quotedCents = toCents(quotedOf(fact) as number);
    const commissionCents = quotedCommissionCents(fact, payment, quotedCents);
    quotedGmv += quotedCents;
    quotedCommission += commissionCents;
    const entry = classifyLeakage(fact, payment, quotedCents, commissionCents);
    if (entry) {
      const step = steps.get(entry.key) as { shipments: number; gmvCents: number; commissionCents: number };
      step.shipments += 1;
      step.gmvCents += entry.gmvCents;
      step.commissionCents += entry.commissionCents;
    }
    if (!entry || entry.gmvCents < quotedCents) capturedCount += 1;
  }
  const lostGmv = sumOf([...steps.values()].map((step) => step.gmvCents));
  const lostCommission = sumOf([...steps.values()].map((step) => step.commissionCents));
  const amounts = (shipments: number, gmvCents: number, commissionCents: number): CaptureAmounts => ({
    shipments,
    gmvArs: fromCents(gmvCents),
    commissionArs: fromCents(commissionCents),
  });
  const capturedGmv = quotedGmv - lostGmv;
  return {
    leakage: {
      quoted: amounts(cohort.length, quotedGmv, quotedCommission),
      steps: CAPTURE_LEAKAGE_STEPS.map((key) => {
        const step = steps.get(key) as { shipments: number; gmvCents: number; commissionCents: number };
        return { key, timing: TIMING_STEPS.has(key), ...amounts(step.shipments, step.gmvCents, step.commissionCents) };
      }),
      captured: amounts(capturedCount, capturedGmv, quotedCommission - lostCommission),
    },
    captureRate: quotedGmv === 0 ? null : reportRate(capturedGmv, quotedGmv),
  };
}

/** Precio del modelo: `pesos por litro × (litros por distancia + litros por paquete) × recargo por demanda`. */
interface PriceFactors {
  fuel: number;
  distanceLiters: number;
  packageLiters: number;
  demand: number;
}

function factorsOf(breakdown: QuoteBreakdown | null): PriceFactors | null {
  if (!breakdown || !breakdown.fuelArsPerLiter) return null;
  return {
    fuel: breakdown.fuelArsPerLiter,
    distanceLiters: (breakdown.distance * breakdown.packageFactor) / breakdown.fuelArsPerLiter,
    packageLiters: ((breakdown.base + breakdown.weight) * breakdown.packageFactor) / breakdown.fuelArsPerLiter,
    demand: breakdown.demandMultiplier,
  };
}

const priceOf = (fuel: number, distanceLiters: number, packageLiters: number, demand: number): number => fuel * (distanceLiters + packageLiters) * demand;

function meanFactors(facts: readonly ShipmentReportFact[]): PriceFactors | null {
  const factors = facts.flatMap((fact) => {
    const of = factorsOf(fact.breakdown);
    return of ? [of] : [];
  });
  if (factors.length === 0) return null;
  const mean = (pick: (row: PriceFactors) => number) => sumOf(factors.map(pick)) / factors.length;
  return {
    fuel: mean((row) => row.fuel),
    distanceLiters: mean((row) => row.distanceLiters),
    packageLiters: mean((row) => row.packageLiters),
    demand: mean((row) => row.demand),
  };
}

function modalMethod(facts: readonly ShipmentReportFact[]): string | null {
  const counts = new Map<string, number>();
  for (const fact of facts) if (fact.calculationMethod) counts.set(fact.calculationMethod, (counts.get(fact.calculationMethod) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function negotiationGap(fact: ShipmentReportFact): number | null {
  return fact.agreedPriceArs === null || fact.suggestedPriceArs === null ? null : fact.agreedPriceArs - fact.suggestedPriceArs;
}

/**
 * Puente del GMV (DD-059). Dentro de cada tramo, cada envío con desglose se recotiza con el factor medio del período
 * anterior, en este orden: combustible, demanda, distancia y paquete. Lo que no se explica va a `algorithm` si cambió la
 * versión dominante del tramo, y si no a `other`, igual que los envíos sin desglose guardado.
 */
export function gmvBridge(facts: readonly ShipmentReportFact[], range: ReportRange): GmvBridge | null {
  const current = completedIn(facts, range);
  const before = completedIn(facts, previousReportRange(range));
  if (current.length === 0 || before.length === 0) return null;

  const gmv1 = gmvOf(current);
  const gmv0 = gmvOf(before);
  const q1 = current.length;
  const q0 = before.length;
  const ticket0 = gmv0 / q0;

  const amounts = new Map<PriceComponent, number>(PRICE_COMPONENTS.map((key) => [key, 0]));
  const add = (key: PriceComponent, amount: number) => amounts.set(key, (amounts.get(key) ?? 0) + amount);

  let mix = 0;
  // Los envíos sin distancia forman su propio grupo, para que el puente cierre con todos.
  for (const band of [...DISTANCE_BANDS, null] as const) {
    const rows1 = current.filter((fact) => fact.band === band);
    const rows0 = before.filter((fact) => fact.band === band);
    if (rows1.length === 0 && rows0.length === 0) continue;
    const bandTicket0 = ticketOf(rows0) ?? ticket0;
    mix += q1 * (rows1.length / q1 - rows0.length / q0) * bandTicket0;
    if (rows1.length === 0) continue;

    const bandEffect = gmvOf(rows1) - rows1.length * bandTicket0;
    let attributed = 0;
    const attribute = (key: PriceComponent, amount: number) => {
      add(key, amount);
      attributed += amount;
    };

    const prior = meanFactors(rows0);
    if (prior) {
      for (const fact of rows1) {
        const now = factorsOf(fact.breakdown);
        if (!now) continue;
        const start = priceOf(now.fuel, now.distanceLiters, now.packageLiters, now.demand);
        const afterFuel = priceOf(prior.fuel, now.distanceLiters, now.packageLiters, now.demand);
        const afterDemand = priceOf(prior.fuel, now.distanceLiters, now.packageLiters, prior.demand);
        const afterDistance = priceOf(prior.fuel, prior.distanceLiters, now.packageLiters, prior.demand);
        const afterPackage = priceOf(prior.fuel, prior.distanceLiters, prior.packageLiters, prior.demand);
        attribute("fuel", start - afterFuel);
        attribute("demand", afterFuel - afterDemand);
        attribute("distance", afterDemand - afterDistance);
        attribute("package", afterDistance - afterPackage);
      }
    }

    const gaps0 = rows0.flatMap((fact) => {
      const gap = negotiationGap(fact);
      return gap === null ? [] : [gap];
    });
    const meanGap0 = gaps0.length === 0 ? 0 : sumOf(gaps0) / gaps0.length;
    for (const fact of rows1) {
      const gap = negotiationGap(fact);
      if (gap !== null) attribute("negotiation", gap - meanGap0);
    }

    const method0 = modalMethod(rows0);
    const method1 = modalMethod(rows1);
    add(method0 && method1 && method0 !== method1 ? "algorithm" : "other", bandEffect - attributed);
  }

  const previous = reportRound(gmv0);
  const currentGmv = reportRound(gmv1);
  const volume = reportRound((q1 - q0) * ticket0);
  const roundedMix = reportRound(mix);
  // Todo en centavos: el redondeo de cada componente lo absorbe `other` y el puente cierra exacto.
  const totalPriceCents = toCents(currentGmv) - toCents(previous) - toCents(volume) - toCents(roundedMix);
  const attributedCents = PRICE_COMPONENTS.filter((key) => key !== "other").map((key) => toCents(amounts.get(key) ?? 0));
  const otherCents = totalPriceCents - sumOf(attributedCents);
  return {
    previous,
    current: currentGmv,
    volume,
    mix: roundedMix,
    price: PRICE_COMPONENTS.map((key) => ({ key, amount: key === "other" ? fromCents(otherCents) : fromCents(toCents(amounts.get(key) ?? 0)) })),
  };
}

/** Precio a mix de distancias constante del período contra otro: los tramos de hoy, a sus tickets de entonces. Base 100. */
function priceIndexOf(facts: readonly ShipmentReportFact[], period: ReportRange, base: ReportRange): number | null {
  const current = completedIn(facts, period);
  const before = completedIn(facts, base);
  if (current.length === 0 || before.length === 0) return null;
  const ticket0 = gmvOf(before) / before.length;
  let atBasePrices = 0;
  for (const band of [...DISTANCE_BANDS, null] as const) {
    const count = current.filter((fact) => fact.band === band).length;
    atBasePrices += count * (ticketOf(before.filter((fact) => fact.band === band)) ?? ticket0);
  }
  return atBasePrices === 0 ? null : Math.round((gmvOf(current) / atBasePrices) * 1000) / 10;
}

export function pricingReport(
  facts: readonly ShipmentReportFact[],
  payments: PaymentFactsById,
  range: ReportRange,
  now: Date,
): ReportSource<PricingReport> {
  const body = buildReportBody(
    range,
    PRICING_KPIS,
    (period) => {
      const completed = completedIn(facts, period);
      return {
        completed: completed.length,
        avgTicket: roundedOrNull(ticketOf(completed)),
        priceIndex: null,
        captureRate: captureLeakage(facts, payments, period)?.captureRate ?? null,
      };
    },
    now,
  );
  const indexOf = (period: ReportRange, base: ReportRange) => {
    const value = priceIndexOf(facts, period, base);
    return { value, previous: value === null ? null : 100 };
  };
  body.kpis.priceIndex = indexOf(range, previousReportRange(range));
  const buckets = reportBuckets(range);
  body.series.priceIndex = buckets.map((bucket) => ({ start: bucket.from, end: bucket.to, ...indexOf(bucket, bucket.previous) }));

  return {
    ...body,
    breakdowns: [bandBreakdown(facts, range, "completed", (rows) => rows.length)],
    bridge: gmvBridge(facts, range),
    leakage: captureLeakage(facts, payments, range)?.leakage ?? null,
  };
}
