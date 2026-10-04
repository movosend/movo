import { PricingGameSessionForStats } from "../models/pricing-game";

/**
 * Agregados del juego de precios de la feria. Se calculan en memoria sobre las últimas
 * N partidas (una feria son cientos, no millones): más simple de testear que SQL con
 * `percentile_cont`, y la misma función sirve para el informe.
 *
 * - `wtpRatio` = lo que el visitante pagaría / precio sugerido (1 = acepta el precio).
 * - `wtaRatio` = lo que pediría como transportista / ganancia ofrecida (1 = acepta).
 * Solo cuentan las partidas con monto declarado (los "ni así" no tienen número; se
 * reflejan en `answers.no` y en `rejectedAll`).
 */

export const DISTANCE_BUCKETS = [
  { id: "lt100", label: "< 100 km", min: 0, max: 100 },
  { id: "100to500", label: "100–500 km", min: 100, max: 500 },
  { id: "gte500", label: "≥ 500 km", min: 500, max: Infinity },
] as const;

export interface AnswerCounts {
  yes: number;
  maybe: number;
  no: number;
}

export interface RatioSummary {
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export interface SideStats {
  answers: AnswerCounts;
  /** Dijeron "no"/"lo pensaría" y además "ni así" (sin monto). */
  rejectedAll: number;
  ratio: RatioSummary;
}

export interface GroupStats {
  sessions: number;
  sender: SideStats;
  courier: SideStats;
}

export interface PricingGameStats extends GroupStats {
  completed: number;
  completionRate: number | null;
  byPackage: Record<string, GroupStats>;
  byDistance: Record<string, GroupStats & { label: string }>;
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const value = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return Math.round(value * 1000) / 1000;
}

function summarize(ratios: number[]): RatioSummary {
  const sorted = [...ratios].sort((a, b) => a - b);
  return { n: sorted.length, median: quantile(sorted, 0.5), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75) };
}

function side(
  rows: PricingGameSessionForStats[],
  answerOf: (r: PricingGameSessionForStats) => string | null,
  amountOf: (r: PricingGameSessionForStats) => number | null,
  baseOf: (r: PricingGameSessionForStats) => number | null
): SideStats {
  const answers: AnswerCounts = { yes: 0, maybe: 0, no: 0 };
  const ratios: number[] = [];
  let rejectedAll = 0;
  for (const r of rows) {
    const answer = answerOf(r);
    if (answer !== "yes" && answer !== "maybe" && answer !== "no") continue;
    answers[answer] += 1;
    const amount = amountOf(r);
    const base = baseOf(r);
    if (amount == null) {
      if (answer !== "yes") rejectedAll += 1;
      continue;
    }
    if (base != null && base > 0) ratios.push(amount / base);
  }
  return { answers, rejectedAll, ratio: summarize(ratios) };
}

function group(rows: PricingGameSessionForStats[]): GroupStats {
  return {
    sessions: rows.length,
    sender: side(rows, (r) => r.senderAnswer, (r) => r.senderWtpArs, (r) => r.suggestedPriceArs),
    courier: side(rows, (r) => r.courierAnswer, (r) => r.courierWtaArs, (r) => r.courierEarnArs),
  };
}

export function computePricingGameStats(rows: PricingGameSessionForStats[]): PricingGameStats {
  const completed = rows.filter((r) => r.completed).length;

  const byPackage: Record<string, GroupStats> = {};
  const presets = [...new Set(rows.map((r) => r.packagePreset).filter((p): p is string => p != null))];
  for (const preset of presets) {
    byPackage[preset] = group(rows.filter((r) => r.packagePreset === preset));
  }

  const byDistance: PricingGameStats["byDistance"] = {};
  for (const bucket of DISTANCE_BUCKETS) {
    const inBucket = rows.filter((r) => r.distanceKm != null && r.distanceKm >= bucket.min && r.distanceKm < bucket.max);
    byDistance[bucket.id] = { label: bucket.label, ...group(inBucket) };
  }

  return {
    ...group(rows),
    completed,
    completionRate: rows.length ? Math.round((completed / rows.length) * 1000) / 1000 : null,
    byPackage,
    byDistance,
  };
}
