/**
 * Lógica pura del juego del optimizador de la feria (sin I/O): recortar la matriz de la
 * ciudad a los puntos de la partida, medir un orden de paradas sobre esa matriz y armar
 * el ranking del día. El orden óptimo lo resuelve OR-Tools en pricing-logistics; acá
 * solo se mide, con la misma matriz, para que la comparación sea justa.
 */

export interface RouteMatrix {
  distKm: number[][];
  timeMin: number[][];
}

/** Diferencia en km por debajo de la cual se considera que el jugador igualó al optimizador. */
export const ROUTE_GAME_TIE_KM = 0.05;

/** Submatriz con las filas/columnas de `indices` (índices del pool), en ese orden. */
export function subMatrix(matrix: RouteMatrix, indices: number[]): RouteMatrix {
  const pick = (m: number[][]) => indices.map((i) => indices.map((j) => m[i][j]));
  return { distKm: pick(matrix.distKm), timeMin: pick(matrix.timeMin) };
}

/**
 * Km y minutos de recorrer `order` (índices de parada 0..n-1) sobre una submatriz con
 * forma `[salida, parada 0..n-1, llegada]`.
 */
export function routeCost(matrix: RouteMatrix, order: number[]): { km: number; min: number } {
  const nodes = [0, ...order.map((i) => i + 1), order.length + 1];
  let km = 0;
  let min = 0;
  for (let k = 1; k < nodes.length; k++) {
    km += matrix.distKm[nodes[k - 1]][nodes[k]];
    min += matrix.timeMin[nodes[k - 1]][nodes[k]];
  }
  return { km, min };
}

/** `true` si `order` es una permutación de 0..n-1. */
export function isPermutation(order: number[], n: number): boolean {
  if (order.length !== n) return false;
  const seen = new Set(order);
  return seen.size === n && order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Orden inicial de las tarjetas: al azar pero nunca igual al óptimo (si coincide se
 * invierte, que con 2 o más paradas siempre es distinto).
 */
export function initialOrder(n: number, optimal: number[], random: () => number = Math.random): number[] {
  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    random
  );
  return order.join() === optimal.join() ? order.reverse() : order;
}

export interface RouteGameScore {
  userKm: number;
  userMin: number;
  extraKm: number;
  extraMin: number;
  efficiencyPct: number;
  tie: boolean;
}

/** Eficiencia = km óptimos / km del jugador (tope 100%, mismo criterio que el prototipo). */
export function scoreRoute(user: { km: number; min: number }, optimal: { km: number; min: number }): RouteGameScore {
  const tie = user.km - optimal.km < ROUTE_GAME_TIE_KM;
  const efficiencyPct = tie || user.km <= 0 ? 100 : Math.min(100, (optimal.km / user.km) * 100);
  return {
    userKm: user.km,
    userMin: user.min,
    extraKm: Math.max(0, user.km - optimal.km),
    extraMin: Math.max(0, user.min - optimal.min),
    efficiencyPct,
    tie,
  };
}

/** Argentina no tiene horario de verano: el día del stand arranca a las 03:00 UTC. */
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Inicio (UTC) del día de `now` en hora de Argentina. */
export function argentinaDayStart(now: Date): Date {
  const local = now.getTime() - AR_OFFSET_MS;
  return new Date(local - (((local % DAY_MS) + DAY_MS) % DAY_MS) + AR_OFFSET_MS);
}

export interface RankingRow {
  id: string;
  name: string | null;
  efficiencyPct: number;
  timeUsedSec: number;
  endedAt: Date;
}

export interface RankingEntry {
  id: string;
  position: number;
  name: string;
  efficiencyPct: number;
  timeUsedSec: number;
  mine: boolean;
}

export interface Ranking {
  total: number;
  /** Puesto (1-based) de `gameId`, o `null` si no está en el ranking. */
  position: number | null;
  entries: RankingEntry[];
}

export const RANKING_SIZE = 7;

/**
 * Ranking del día: más eficiencia primero, a igual eficiencia el más rápido, y a igual
 * tiempo el que terminó antes. Muestra el top 7; si `gameId` quedó afuera, el top 6 más
 * su fila (como `board()` del prototipo).
 */
export function buildRanking(rows: RankingRow[], gameId?: string): Ranking {
  const sorted = rows
    .slice()
    .sort(
      (a, b) =>
        b.efficiencyPct - a.efficiencyPct ||
        a.timeUsedSec - b.timeUsedSec ||
        a.endedAt.getTime() - b.endedAt.getTime()
    );
  const index = gameId ? sorted.findIndex((r) => r.id === gameId) : -1;
  const shown =
    index >= RANKING_SIZE
      ? [...sorted.slice(0, RANKING_SIZE - 1).map((r, i) => ({ r, i })), { r: sorted[index], i: index }]
      : sorted.slice(0, RANKING_SIZE).map((r, i) => ({ r, i }));
  return {
    total: sorted.length,
    position: index >= 0 ? index + 1 : null,
    entries: shown.map(({ r, i }) => ({
      id: r.id,
      position: i + 1,
      name: r.name ?? "",
      efficiencyPct: r.efficiencyPct,
      timeUsedSec: r.timeUsedSec,
      mine: r.id === gameId,
    })),
  };
}
