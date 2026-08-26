/**
 * MOVO-147: cálculo del score de reputación ponderado. Función pura sobre una lista
 * de `{ score, createdAt }` -- sin acceso a base, testeable al detalle (AC1), mismo
 * criterio que `shipment-state-machine.ts`/`rating-window.ts`.
 *
 * Combina dos correcciones sobre la media simple (una media simple no sirve: un
 * transportista con UNA calificación de 5 quedaría por encima de uno con cuarenta de
 * 4,8):
 *
 * 1. Shrinkage bayesiano hacia la media global de la plataforma (mismo mecanismo que
 *    IMDb/BeerAdvocate): `(C·m + Σscores) / (C + n)`. Con pocas calificaciones el
 *    score tiende a `m`; a medida que se acumulan, tiende a la media real de la
 *    persona.
 * 2. Decaimiento temporal: cada calificación pesa `0.5 ^ (antigüedad_en_días /
 *    semivida)` -- una racha vieja no sostiene a alguien que hoy trabaja mal.
 *
 * Las dos correcciones se combinan reemplazando `n` y `Σscores` de la fórmula 1 por su
 * versión ponderada por el peso de decaimiento de cada calificación (`Σpeso` y
 * `Σpeso·score`) -- una calificación vieja cuenta como una fracción de calificación,
 * no como una entera, tanto para el promedio como para cuánto "empuja" hacia la media
 * real en vez de hacia `m`.
 */

export interface RatingForReputation {
  score: number;
  createdAt: Date;
}

export interface ReputationParams {
  /** `C`: constante de confianza del shrinkage bayesiano (env `REPUTATION_CONFIDENCE_CONSTANT`). */
  confidenceConstant: number;
  /** `m`: media global de calificaciones de la plataforma en este momento. */
  globalAverageScore: number;
  /** Semivida del decaimiento temporal, en días (env `REPUTATION_DECAY_HALF_LIFE_DAYS`). */
  decayHalfLifeDays: number;
  /** Override solo para tests -- por defecto `new Date()`. */
  now?: Date;
}

export interface ReputationResult {
  /**
   * AC2: `null` únicamente cuando `ratings` está vacío -- un cero es una nota
   * pésima, no ausencia de datos (el mobile ya distingue el caso,
   * `formatReputationScore`). Redondeado a un decimal.
   */
  reputationScore: number | null;
  ratingCount: number;
  /**
   * AC2: con menos de `MIN_RATINGS_FOR_ESTABLISHED_PROFILE` calificaciones el número
   * no informa -- el cálculo se hace igual (siempre viaja en el resultado), la
   * decisión de mostrar "Perfil nuevo" en vez del score es de presentación, no de
   * este motor.
   */
  isNewProfile: boolean;
}

/** AC2 de la US (MOVO-25): umbral de "perfil nuevo", no configurable vía env -- es un
 * AC fijo del ticket, a diferencia de `confidenceConstant`/`decayHalfLifeDays` que sí
 * son parámetros del modelo. */
export const MIN_RATINGS_FOR_ESTABLISHED_PROFILE = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeReputationScore(
  ratings: readonly RatingForReputation[],
  params: ReputationParams,
): ReputationResult {
  const ratingCount = ratings.length;
  const isNewProfile = ratingCount < MIN_RATINGS_FOR_ESTABLISHED_PROFILE;

  if (ratingCount === 0) {
    return { reputationScore: null, ratingCount, isNewProfile };
  }

  const now = params.now ?? new Date();
  let weightedScoreSum = 0;
  let weightedCount = 0;

  for (const rating of ratings) {
    // `Math.max(0, ...)`: un reloj de servidor levemente desincronizado no debe
    // producir un peso > 1 (calificación "del futuro").
    const ageDays = Math.max(0, (now.getTime() - rating.createdAt.getTime()) / MS_PER_DAY);
    const weight = Math.pow(0.5, ageDays / params.decayHalfLifeDays);
    weightedScoreSum += weight * rating.score;
    weightedCount += weight;
  }

  const shrunkScore =
    (params.confidenceConstant * params.globalAverageScore + weightedScoreSum) /
    (params.confidenceConstant + weightedCount);

  return {
    reputationScore: Math.round(shrunkScore * 10) / 10,
    ratingCount,
    isNewProfile,
  };
}
