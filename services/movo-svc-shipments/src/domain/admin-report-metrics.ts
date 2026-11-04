import {
  buildReportBody,
  CarrierSupplyPoint,
  CARRIERS_KPIS,
  CarriersReport,
  DeliveriesReport,
  DELIVERIES_KPIS,
  DeliveryDelayReason,
  DELIVERY_DELAY_REASONS,
  DISTANCE_BANDS,
  distanceBandOf,
  DistanceBand,
  DistancesReport,
  DISTANCES_KPIS,
  isInReportRange,
  previousReportRange,
  ReportBreakdown,
  reportBuckets,
  ReportCorridor,
  reportMedian,
  reportRate,
  ReportRange,
  reportRound,
  ReportScorecardRow,
  ReportSource,
  ReportValue,
  SupportKpi,
  SUPPORT_KPIS,
  SupportReport,
} from "@movo/shared";
import { roadDistanceEstimateKm } from "./geo";

const HOUR_MS = 60 * 60 * 1000;
const CORRIDORS_LIMIT = 20;

/** Un envío con todo lo que miden Entregas, Transportistas y Distancias. Las fechas son ISO. */
export interface ShipmentMetricFact {
  band: DistanceBand | null;
  distanceKm: number | null;
  agreedPriceArs: number | null;
  publishedAt: string | null;
  firstAssignedAt: string | null;
  pickedUpAt: string | null;
  firstCompletedAt: string | null;
  deliveredAt: string | null;
  /** Fin de la franja de entrega estimada. `null`: el transportista no la informó. */
  deliveryDeadline: string | null;
  pickupDeadline: string | null;
  anomalyFlagged: boolean;
  hasDispute: boolean;
  pickupCity: string | null;
  deliveryCity: string | null;
  pickupLat: number;
  pickupLng: number;
  deliveryLat: number;
  deliveryLng: number;
}

export interface SupportMetricFact {
  topic: string;
  createdAt: string;
  firstAgentAt: string | null;
  resolvedAt: string | null;
  /** El usuario volvió a escribir después de la primera respuesta del equipo. */
  userWroteAfterAgent: boolean;
}

export interface CarrierActivityDay {
  /** Día de Argentina, `YYYY-MM-DD`. */
  day: string;
  carriers: number;
}

const hoursBetween = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / HOUR_MS;
const sumOf = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const isLate = (fact: ShipmentMetricFact): boolean =>
  fact.deliveredAt !== null && fact.deliveryDeadline !== null && Date.parse(fact.deliveredAt) > Date.parse(fact.deliveryDeadline);

/** DD-059: un solo motivo por envío tarde. */
export function delayReasonOf(fact: ShipmentMetricFact): DeliveryDelayReason {
  if (fact.anomalyFlagged) return "gps_anomaly";
  if (fact.pickedUpAt && fact.pickupDeadline && Date.parse(fact.pickedUpAt) > Date.parse(fact.pickupDeadline)) return "pickup_late";
  return "in_route";
}

const assignedWithin24h = (fact: ShipmentMetricFact): boolean =>
  fact.publishedAt !== null && fact.firstAssignedAt !== null && hoursBetween(fact.publishedAt, fact.firstAssignedAt) <= 24;

const deliveredIn = (facts: readonly ShipmentMetricFact[], range: ReportRange) => facts.filter((fact) => isInReportRange(fact.deliveredAt, range));
const publishedIn = (facts: readonly ShipmentMetricFact[], range: ReportRange) => facts.filter((fact) => isInReportRange(fact.publishedAt, range));
const completedIn = (facts: readonly ShipmentMetricFact[], range: ReportRange) => facts.filter((fact) => isInReportRange(fact.firstCompletedAt, range));

function onTimeRateOf(facts: readonly ShipmentMetricFact[], range: ReportRange): number | null {
  const withEstimate = deliveredIn(facts, range).filter((fact) => fact.deliveryDeadline !== null);
  return reportRate(withEstimate.filter((fact) => !isLate(fact)).length, withEstimate.length);
}

function doorToDoorOf(facts: readonly ShipmentMetricFact[], range: ReportRange): number | null {
  return reportMedian(
    deliveredIn(facts, range).flatMap((fact) => (fact.pickedUpAt && fact.deliveredAt ? [hoursBetween(fact.pickedUpAt, fact.deliveredAt)] : [])),
  );
}

const assignedRateOf = (facts: readonly ShipmentMetricFact[], range: ReportRange): number | null => {
  const published = publishedIn(facts, range);
  return reportRate(published.filter(assignedWithin24h).length, published.length);
};

const completionRateOf = (facts: readonly ShipmentMetricFact[], range: ReportRange): number | null => {
  const published = publishedIn(facts, range);
  return reportRate(published.filter((fact) => fact.firstCompletedAt !== null).length, published.length);
};

const avgTicketOf = (facts: readonly ShipmentMetricFact[], range: ReportRange): number | null => {
  const prices = completedIn(facts, range).flatMap((fact) => (fact.agreedPriceArs === null ? [] : [fact.agreedPriceArs]));
  return prices.length === 0 ? null : reportRound(sumOf(prices) / prices.length);
};

const timeToAssignOf = (facts: readonly ShipmentMetricFact[], range: ReportRange): number | null =>
  reportMedian(
    publishedIn(facts, range).flatMap((fact) => (fact.publishedAt && fact.firstAssignedAt ? [hoursBetween(fact.publishedAt, fact.firstAssignedAt)] : [])),
  );

export function deliveriesReport(facts: readonly ShipmentMetricFact[], range: ReportRange, now: Date): ReportSource<DeliveriesReport> {
  const body = buildReportBody(
    range,
    DELIVERIES_KPIS,
    (period) => {
      const delivered = deliveredIn(facts, period);
      return {
        onTimeRate: onTimeRateOf(facts, period),
        doorToDoorHours: doorToDoorOf(facts, period),
        incidentRate: reportRate(delivered.filter((fact) => fact.hasDispute || fact.anomalyFlagged).length, delivered.length),
        lateCount: delivered.filter(isLate).length,
      };
    },
    now,
  );
  const previous = previousReportRange(range);
  const lateBy = (period: ReportRange, reason: DeliveryDelayReason) =>
    deliveredIn(facts, period).filter((fact) => isLate(fact) && delayReasonOf(fact) === reason).length;
  const total = body.kpis.lateCount;
  const delayReason: ReportBreakdown = {
    dimension: "delayReason",
    metric: "lateCount",
    total,
    rows: DELIVERY_DELAY_REASONS.map((key) => {
      const value = lateBy(range, key);
      return { key, value, previous: lateBy(previous, key), share: reportRate(value, total.value ?? 0) };
    }).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)),
  };
  return { ...body, breakdowns: [delayReason] };
}

export function carriersReport(
  facts: readonly ShipmentMetricFact[],
  activity: readonly CarrierActivityDay[],
  range: ReportRange,
  now: Date,
): ReportSource<CarriersReport> {
  const carriersByDay = new Map(activity.map((row) => [row.day, row.carriers]));
  const activeCarriersOf = (period: ReportRange): number => {
    const days = daysOf(period);
    return reportRound(sumOf(days.map((day) => carriersByDay.get(day) ?? 0)) / days.length);
  };
  const body = buildReportBody(
    range,
    CARRIERS_KPIS,
    (period) => ({
      assignedWithin24hRate: assignedRateOf(facts, period),
      timeToAssignHours: timeToAssignOf(facts, period),
      activeCarriers: activeCarriersOf(period),
    }),
    now,
  );
  const previous = previousReportRange(range);
  const inBand = (band: DistanceBand) => facts.filter((fact) => fact.band === band);
  const breakdown: ReportBreakdown = {
    dimension: "band",
    metric: "assignedWithin24hRate",
    total: body.kpis.assignedWithin24hRate,
    rows: DISTANCE_BANDS.map((key) => ({
      key,
      value: assignedRateOf(inBand(key), range),
      previous: assignedRateOf(inBand(key), previous),
      share: null,
      extra: { timeToAssignHours: timeToAssignOf(inBand(key), range) },
    })),
  };
  const supply: CarrierSupplyPoint[] = reportBuckets(range).map((bucket) => {
    const published = publishedIn(facts, bucket);
    return { start: bucket.from, end: bucket.to, published: published.length, assignedWithin24h: published.filter(assignedWithin24h).length };
  });
  return { ...body, breakdowns: [breakdown], supply };
}

function daysOf({ from, to }: ReportRange): string[] {
  const days: string[] = [];
  const last = Date.parse(`${to}T00:00:00.000Z`);
  for (let at = Date.parse(`${from}T00:00:00.000Z`); at <= last; at += 24 * HOUR_MS) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

function corridorsOf(facts: readonly ShipmentMetricFact[], range: ReportRange): ReportCorridor[] {
  const previous = previousReportRange(range);
  const groups = new Map<string, { origin: string; destination: string; current: ShipmentMetricFact[]; before: number }>();
  const groupOf = (fact: ShipmentMetricFact) => {
    if (!fact.pickupCity || !fact.deliveryCity) return null;
    const key = `${fact.pickupCity}\u0000${fact.deliveryCity}`;
    let group = groups.get(key);
    if (!group) {
      group = { origin: fact.pickupCity, destination: fact.deliveryCity, current: [], before: 0 };
      groups.set(key, group);
    }
    return group;
  };
  for (const fact of publishedIn(facts, range)) groupOf(fact)?.current.push(fact);
  for (const fact of publishedIn(facts, previous)) {
    const key = `${fact.pickupCity}\u0000${fact.deliveryCity}`;
    const group = groups.get(key);
    if (group) group.before += 1;
  }
  const mean = (values: readonly number[]) => sumOf(values) / values.length;
  return [...groups.values()]
    .filter((group) => group.current.length > 0)
    .map((group): ReportCorridor => {
      const shipments = group.current;
      const distances = shipments.flatMap((fact) => (fact.distanceKm === null ? [] : [fact.distanceKm]));
      const originLat = mean(shipments.map((fact) => fact.pickupLat));
      const originLng = mean(shipments.map((fact) => fact.pickupLng));
      const destinationLat = mean(shipments.map((fact) => fact.deliveryLat));
      const destinationLng = mean(shipments.map((fact) => fact.deliveryLng));
      // Sin ninguna distancia guardada, la misma estimación que un envío sin cotización (DD-059).
      const distanceKm = distances.length === 0 ? roadDistanceEstimateKm(originLat, originLng, destinationLat, destinationLng) : reportRound(mean(distances));
      return {
        originCity: group.origin,
        destinationCity: group.destination,
        originLat: reportRound(originLat),
        originLng: reportRound(originLng),
        destinationLat: reportRound(destinationLat),
        destinationLng: reportRound(destinationLng),
        distanceKm,
        band: distanceBandOf(distanceKm),
        published: shipments.length,
        publishedPrevious: group.before,
        completionRate: reportRate(shipments.filter((fact) => fact.firstCompletedAt !== null).length, shipments.length),
      };
    })
    .sort((a, b) => b.published - a.published || a.originCity.localeCompare(b.originCity) || a.destinationCity.localeCompare(b.destinationCity))
    .slice(0, CORRIDORS_LIMIT);
}

/** `all` trae los envíos de todos los tramos: el scorecard ignora el filtro. `facts` son los del tramo pedido. */
export function distancesReport(
  facts: readonly ShipmentMetricFact[],
  all: readonly ShipmentMetricFact[],
  range: ReportRange,
  now: Date,
): ReportSource<DistancesReport> {
  const body = buildReportBody(
    range,
    DISTANCES_KPIS,
    (period) => {
      const distances = publishedIn(facts, period).flatMap((fact) => (fact.distanceKm === null ? [] : [fact.distanceKm]));
      return {
        published: publishedIn(facts, period).length,
        completionRate: completionRateOf(facts, period),
        avgDistanceKm: distances.length === 0 ? null : reportRound(sumOf(distances) / distances.length),
      };
    },
    now,
  );
  const previous = previousReportRange(range);
  const scorecard: ReportScorecardRow[] = DISTANCE_BANDS.map((band) => {
    const inBand = all.filter((fact) => fact.band === band);
    const metric = (of: (rows: readonly ShipmentMetricFact[], period: ReportRange) => number | null): ReportValue => ({
      value: of(inBand, range),
      previous: of(inBand, previous),
    });
    return {
      band,
      published: metric((rows, period) => publishedIn(rows, period).length),
      completionRate: metric(completionRateOf),
      onTimeRate: metric(onTimeRateOf),
      assignedWithin24hRate: metric(assignedRateOf),
      doorToDoorHours: metric(doorToDoorOf),
      avgTicket: metric(avgTicketOf),
    };
  });
  return { ...body, breakdowns: [], corridors: corridorsOf(facts, range), scorecard };
}

export function supportReport(
  facts: readonly SupportMetricFact[],
  topics: readonly string[],
  range: ReportRange,
  now: Date,
): ReportSource<SupportReport> {
  const openedIn = (period: ReportRange) => facts.filter((fact) => isInReportRange(fact.createdAt, period));
  const body = buildReportBody<SupportKpi>(
    range,
    SUPPORT_KPIS,
    (period) => {
      const opened = openedIn(period);
      const resolved = opened.filter((fact) => fact.resolvedAt !== null);
      return {
        firstResponseMinutes: reportMedian(
          opened.flatMap((fact) => (fact.firstAgentAt ? [hoursBetween(fact.createdAt, fact.firstAgentAt) * 60] : [])),
        ),
        conversations: opened.length,
        firstContactResolutionRate: reportRate(resolved.filter((fact) => !fact.userWroteAfterAgent).length, resolved.length),
      };
    },
    now,
  );
  const previous = previousReportRange(range);
  const total = body.kpis.conversations;
  const topic: ReportBreakdown = {
    dimension: "topic",
    metric: "conversations",
    total,
    rows: topics
      .map((key) => {
        const value = openedIn(range).filter((fact) => fact.topic === key).length;
        return { key, value, previous: openedIn(previous).filter((fact) => fact.topic === key).length, share: reportRate(value, total.value ?? 0) };
      })
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)),
  };
  return { ...body, breakdowns: [topic] };
}
