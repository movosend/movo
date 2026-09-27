import { describe, it, expect } from "vitest";
import { CARRIER_RATING_CATEGORIES } from "@movo/shared";
import {
  computeCategoryScores,
  computeReputationScore,
  MIN_RATINGS_FOR_ESTABLISHED_PROFILE,
  RatingForCategoryReputation,
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

describe("computeCategoryScores (MOVO-173)", () => {
  function withCategories(daysAgo: number, categories: Partial<RatingForCategoryReputation>): RatingForCategoryReputation {
    return { ...rating(4, daysAgo), ...categories };
  }

  it("sin ninguna categoría cargada devuelve undefined (no un array vacío)", () => {
    expect(computeCategoryScores([], CARRIER_RATING_CATEGORIES, BASE_PARAMS)).toBeUndefined();
    expect(
      computeCategoryScores([withCategories(0, { punctualityScore: null })], CARRIER_RATING_CATEGORIES, BASE_PARAMS),
    ).toBeUndefined();
  });

  it("aplica el mismo shrinkage que el score general: una sola calificación no llega a 5.0", () => {
    const result = computeCategoryScores(
      [withCategories(0, { punctualityScore: 5 })],
      CARRIER_RATING_CATEGORIES,
      BASE_PARAMS,
    );
    // (5*3 + 5) / (5 + 1) = 3.33... -> 3.3, exactamente lo mismo que el score general con un 5.
    expect(result).toEqual([{ key: "punctuality", label: "Puntualidad", score: 3.3 }]);
    expect(result?.[0].score).toBe(computeReputationScore([rating(5)], BASE_PARAMS).reputationScore);
  });

  it("promedia cada categoría solo con las calificaciones que la cargaron", () => {
    const ratings = [
      withCategories(0, { punctualityScore: 5, careScore: 5 }),
      withCategories(0, { punctualityScore: 5 }), // sin careScore: no debe arrastrar "Cuidado"
    ];
    const result = computeCategoryScores(ratings, CARRIER_RATING_CATEGORIES, BASE_PARAMS);
    const punctuality = result?.find((c) => c.key === "punctuality");
    const care = result?.find((c) => c.key === "care");
    // Puntualidad tiene 2 muestras y Cuidado 1: con el mismo valor (5), la de más muestras
    // queda más cerca de 5 porque el shrinkage hacia `m` pesa menos.
    expect(punctuality?.score).toBeGreaterThan(care?.score as number);
  });

  it("una calificación vieja pesa menos que una reciente (mismo decaimiento que el general)", () => {
    const recent = computeCategoryScores([withCategories(0, { careScore: 5 })], CARRIER_RATING_CATEGORIES, BASE_PARAMS);
    const old = computeCategoryScores([withCategories(365, { careScore: 5 })], CARRIER_RATING_CATEGORIES, BASE_PARAMS);
    expect(old?.[0].score).toBeLessThan(recent?.[0].score as number);
  });

  it("respeta el orden del set y omite las categorías sin datos", () => {
    const result = computeCategoryScores(
      [withCategories(0, { communicationScore: 4, punctualityScore: 4 })],
      CARRIER_RATING_CATEGORIES,
      BASE_PARAMS,
    );
    // El orden es el de la definición (puntualidad, cuidado, comunicación), no el de llegada;
    // "care" no tiene datos y no aparece.
    expect(result?.map((c) => c.key)).toEqual(["punctuality", "communication"]);
  });

  it("con muchas calificaciones consistentes converge al promedio real de la categoría", () => {
    const ratings = Array.from({ length: 200 }, () => withCategories(0, { communicationScore: 4.8 as number }));
    const result = computeCategoryScores(ratings, CARRIER_RATING_CATEGORIES, BASE_PARAMS);
    expect(result?.find((c) => c.key === "communication")?.score).toBeCloseTo(4.8, 1);
  });
});
