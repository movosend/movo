import { describe, it, expect } from "vitest";
import {
  computeReputationScore,
  MIN_RATINGS_FOR_ESTABLISHED_PROFILE,
  RatingForReputation,
  ReputationParams,
} from "../src/domain/reputation";

const BASE_PARAMS: ReputationParams = {
  confidenceConstant: 5,
  globalAverageScore: 3,
  decayHalfLifeDays: 180,
  now: new Date("2030-01-01T00:00:00.000Z"),
};

function rating(score: number, daysAgo = 0): RatingForReputation {
  return { score, createdAt: new Date(BASE_PARAMS.now!.getTime() - daysAgo * 24 * 60 * 60 * 1000) };
}

describe("computeReputationScore (MOVO-147 AC1/AC2)", () => {
  it("AC2: sin calificaciones devuelve reputationScore null, ratingCount 0, isNewProfile true", () => {
    const result = computeReputationScore([], BASE_PARAMS);
    expect(result).toEqual({ reputationScore: null, ratingCount: 0, isNewProfile: true });
  });

  it("AC2: una sola calificación de 5 (C=5) queda cerca de la media global, NUNCA en 5.0", () => {
    const result = computeReputationScore([rating(5)], BASE_PARAMS);
    // (5*3 + 5) / (5 + 1) = 20/6 = 3.33... -> 3.3
    expect(result.reputationScore).toBe(3.3);
    expect(result.reputationScore).not.toBe(5);
    expect(result.reputationScore).toBeGreaterThan(BASE_PARAMS.globalAverageScore);
  });

  it("con muchas calificaciones consistentes, el score converge a la media real (no a `m`)", () => {
    const ratings = Array.from({ length: 200 }, () => rating(4.8));
    const result = computeReputationScore(ratings, BASE_PARAMS);
    expect(result.reputationScore).toBeCloseTo(4.8, 1);
  });

  it("una calificación vieja pesa menos que una reciente del mismo valor", () => {
    const recent = computeReputationScore([rating(5)], BASE_PARAMS);
    const old = computeReputationScore([rating(5, 365)], BASE_PARAMS); // 2 semividas atrás
    // Ambas son la única calificación de la persona -- el shrinkage hacia `m` (3) es
    // más fuerte cuanto menor es el peso de decaimiento, así que la vieja queda más
    // cerca de `m` que la reciente.
    expect(old.reputationScore).toBeLessThan(recent.reputationScore as number);
    expect(old.reputationScore).toBeGreaterThanOrEqual(BASE_PARAMS.globalAverageScore);
  });

  it(`isNewProfile es true con menos de ${MIN_RATINGS_FOR_ESTABLISHED_PROFILE} calificaciones`, () => {
    expect(computeReputationScore([rating(5)], BASE_PARAMS).isNewProfile).toBe(true);
    expect(computeReputationScore([rating(5), rating(4)], BASE_PARAMS).isNewProfile).toBe(true);
  });

  it(`isNewProfile es false con ${MIN_RATINGS_FOR_ESTABLISHED_PROFILE} calificaciones o más`, () => {
    const ratings = [rating(5), rating(4), rating(3)];
    const result = computeReputationScore(ratings, BASE_PARAMS);
    expect(result.isNewProfile).toBe(false);
    expect(result.ratingCount).toBe(3);
  });

  it("el cálculo se hace igual (no null) aunque isNewProfile sea true -- decisión de presentación, no del motor", () => {
    const result = computeReputationScore([rating(5)], BASE_PARAMS);
    expect(result.isNewProfile).toBe(true);
    expect(result.reputationScore).not.toBeNull();
  });

  it("nunca devuelve 0 salvo que el score shrinkeado realmente redondee a 0", () => {
    // C alto + m bajo + una sola calificación mala -- el shrinkage domina, pero el
    // resultado sigue siendo un número real, no un 0 disfrazado de "sin datos".
    const result = computeReputationScore([rating(1)], { ...BASE_PARAMS, globalAverageScore: 1, confidenceConstant: 5 });
    expect(result.reputationScore).toBe(1);
    expect(result.reputationScore).not.toBeNull();
  });

  it("redondea el score a un decimal", () => {
    const result = computeReputationScore([rating(5), rating(4), rating(3)], { ...BASE_PARAMS, globalAverageScore: 4 });
    expect(Number.isInteger((result.reputationScore as number) * 10)).toBe(true);
  });
});
