import {
  buildReportBody,
  CancellationCause,
  CANCELLATION_CAUSES,
  isInReportRange,
  OPERATIONS_CITY_ROWS,
  OPERATIONS_KPIS,
  OPERATIONS_OTHER_CITIES,
  OPERATIONS_UNKNOWN_CITY,
  OperationsCityOption,
  OperationsKpi,
  OperationsReport,
  previousReportRange,
  ReportBreakdown,
  ReportBreakdownRow,
  ReportRange,
  reportRate,
  reportRound,
  ReportSource,
} from "@movo/shared";

/** Un envío con lo que mide Operación. Las fechas son ISO. */
export interface OperationsFact {
  pickupCity: string | null;
  publishedAt: string | null;
  firstCompletedAt: string | null;
  cancelledAt: string | null;
  cancelCause: CancellationCause | null;
  /** `demandRatio` de la cotización; `null` sin desglose o si se cotizó sin conteo de demanda (pricing lo manda en 0). */
  demandRatio: number | null;
  highDemand: boolean | null;
  /** Transportistas que contó la cotización; `null` en los envíos anteriores a esa columna. */
  availableCarriers: number | null;
}

const publishedIn = (facts: readonly OperationsFact[], range: ReportRange) => facts.filter((fact) => isInReportRange(fact.publishedAt, range));
const completedIn = (facts: readonly OperationsFact[], range: ReportRange) => facts.filter((fact) => isInReportRange(fact.firstCompletedAt, range));
const cancelledIn = (facts: readonly OperationsFact[], range: ReportRange) => facts.filter((fact) => isInReportRange(fact.cancelledAt, range));

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return reportRound(values.reduce((total, value) => total + value, 0) / values.length);
}

/** La señal de demanda se mide sobre los publicados del período: es la foto del pricing al publicarse cada uno. */
function metricsOf(facts: readonly OperationsFact[], period: ReportRange): Record<OperationsKpi, number | null> {
  const published = publishedIn(facts, period);
  const withHighDemand = published.filter((fact) => fact.highDemand !== null);
  return {
    published: published.length,
    completed: completedIn(facts, period).length,
    cancelled: cancelledIn(facts, period).length,
    demandRatio: meanOf(published.flatMap((fact) => (fact.demandRatio === null ? [] : [fact.demandRatio]))),
    highDemandRate: reportRate(withHighDemand.filter((fact) => fact.highDemand).length, withHighDemand.length),
    availableCarriers: meanOf(published.flatMap((fact) => (fact.availableCarriers === null ? [] : [fact.availableCarriers]))),
  };
}

const cityKeyOf = (fact: OperationsFact): string => fact.pickupCity ?? OPERATIONS_UNKNOWN_CITY;

/** Ciudades con publicados en el rango, de más a menos. Sin ciudad no entra: no se puede elegir. */
function citiesOf(facts: readonly OperationsFact[], range: ReportRange): OperationsCityOption[] {
  const counts = new Map<string, number>();
  for (const fact of publishedIn(facts, range)) {
    if (fact.pickupCity) counts.set(fact.pickupCity, (counts.get(fact.pickupCity) ?? 0) + 1);
  }
  return [...counts.entries()].map(([city, published]) => ({ city, published })).sort((a, b) => b.published - a.published || a.city.localeCompare(b.city));
}

function cancelCauseBreakdown(facts: readonly OperationsFact[], range: ReportRange, total: ReportBreakdown["total"]): ReportBreakdown {
  const previous = previousReportRange(range);
  const count = (period: ReportRange, cause: CancellationCause) => cancelledIn(facts, period).filter((fact) => fact.cancelCause === cause).length;
  const rows = CANCELLATION_CAUSES.map((key) => {
    const value = count(range, key);
    return { key, value, previous: count(previous, key), share: reportRate(value, total.value ?? 0) };
  }).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  return { dimension: "cancelCause", metric: "cancelled", total, rows };
}

/**
 * Una fila por ciudad del retiro con movimiento en el rango, por publicados. Las que quedan fuera del top se suman en
 * `OPERATIONS_OTHER_CITIES`, así las filas suman el total. `extra` lleva el resto de las métricas de la ciudad.
 */
function cityBreakdown(facts: readonly OperationsFact[], range: ReportRange, total: ReportBreakdown["total"]): ReportBreakdown {
  const previous = previousReportRange(range);
  const groups = new Map<string, OperationsFact[]>();
  for (const fact of facts) {
    const key = cityKeyOf(fact);
    const group = groups.get(key);
    if (group) group.push(fact);
    else groups.set(key, [fact]);
  }
  const rowOf = (key: string, group: readonly OperationsFact[]): ReportBreakdownRow => {
    const current = metricsOf(group, range);
    const value = current.published ?? 0;
    return {
      key,
      value,
      previous: metricsOf(group, previous).published,
      share: reportRate(value, total.value ?? 0),
      extra: {
        completed: current.completed,
        cancelled: current.cancelled,
        demandRatio: current.demandRatio,
        highDemandRate: current.highDemandRate,
        availableCarriers: current.availableCarriers,
      },
    };
  };
  const active = [...groups.entries()]
    .map(([key, group]) => ({ key, group, row: rowOf(key, group) }))
    .filter(({ row }) => (row.value ?? 0) > 0 || (row.extra?.completed ?? 0) > 0 || (row.extra?.cancelled ?? 0) > 0)
    .sort((a, b) => (b.row.value ?? 0) - (a.row.value ?? 0) || (b.row.extra?.cancelled ?? 0) - (a.row.extra?.cancelled ?? 0) || a.key.localeCompare(b.key));
  const rows = active.slice(0, OPERATIONS_CITY_ROWS).map(({ row }) => row);
  const rest = active.slice(OPERATIONS_CITY_ROWS).flatMap(({ group }) => group);
  if (rest.length > 0) rows.push(rowOf(OPERATIONS_OTHER_CITIES, rest));
  return { dimension: "city", metric: "published", total, rows };
}

/** MOVO-35 B1-B4: Operación. Con `city`, todo se mide sobre los envíos retirados en esa ciudad salvo `cities`. */
export function operationsReport(all: readonly OperationsFact[], range: ReportRange, now: Date, city?: string): ReportSource<OperationsReport> {
  const facts = city ? all.filter((fact) => fact.pickupCity === city) : all;
  const body = buildReportBody(range, OPERATIONS_KPIS, (period) => metricsOf(facts, period), now);
  return {
    ...body,
    breakdowns: [cancelCauseBreakdown(facts, range, body.kpis.cancelled), cityBreakdown(facts, range, body.kpis.published)],
    city: city ?? null,
    cities: citiesOf(all, range),
  };
}
