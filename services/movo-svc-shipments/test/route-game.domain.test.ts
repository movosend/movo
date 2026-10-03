import { describe, it, expect } from "vitest";
import {
  argentinaDayStart,
  buildRanking,
  initialOrder,
  isPermutation,
  RankingRow,
  routeCost,
  scoreRoute,
  subMatrix,
} from "../src/domain/route-game";

// [salida, A, B, llegada]: A→B suma 3 km, B→A suma 11.
const matrix = {
  distKm: [
    [0, 1, 5, 9],
    [1, 0, 1, 5],
    [5, 1, 0, 1],
    [9, 5, 1, 0],
  ],
  timeMin: [
    [0, 2, 10, 18],
    [2, 0, 2, 10],
    [10, 2, 0, 2],
    [18, 10, 2, 0],
  ],
};

describe("juego del optimizador: dominio", () => {
  it("routeCost recorre salida → paradas en orden → llegada", () => {
    expect(routeCost(matrix, [0, 1])).toEqual({ km: 3, min: 6 });
    expect(routeCost(matrix, [1, 0])).toEqual({ km: 11, min: 22 });
  });

  it("subMatrix recorta filas y columnas en el orden pedido", () => {
    expect(subMatrix(matrix, [3, 0]).distKm).toEqual([
      [0, 9],
      [9, 0],
    ]);
  });

  it("isPermutation exige cada parada una sola vez", () => {
    expect(isPermutation([2, 0, 1], 3)).toBe(true);
    expect(isPermutation([0, 0, 1], 3)).toBe(false);
    expect(isPermutation([0, 1], 3)).toBe(false);
    expect(isPermutation([0, 1, 3], 3)).toBe(false);
  });

  it("initialOrder nunca coincide con el óptimo", () => {
    // random() = 0.99 deja el shuffle en el orden identidad.
    expect(initialOrder(4, [0, 1, 2, 3], () => 0.99)).not.toEqual([0, 1, 2, 3]);
    for (let i = 0; i < 50; i++) {
      expect(initialOrder(4, [2, 0, 3, 1]).join()).not.toBe("2,0,3,1");
    }
  });

  it("scoreRoute: eficiencia = óptimo / jugador, empate bajo 50 m", () => {
    const opt = { km: 3, min: 6 };
    expect(scoreRoute({ km: 4, min: 8 }, opt)).toMatchObject({ efficiencyPct: 75, tie: false, extraKm: 1, extraMin: 2 });
    expect(scoreRoute({ km: 3.04, min: 6 }, opt)).toMatchObject({ efficiencyPct: 100, tie: true });
    // Si el jugador encontrara algo más corto que el optimizador, la eficiencia queda en 100.
    expect(scoreRoute({ km: 2.5, min: 5 }, opt)).toMatchObject({ efficiencyPct: 100, extraKm: 0, extraMin: 0 });
  });

  it("argentinaDayStart corta a las 00:00 de Argentina (03:00 UTC)", () => {
    expect(argentinaDayStart(new Date("2026-10-10T15:00:00Z")).toISOString()).toBe("2026-10-10T03:00:00.000Z");
    // 01:00 UTC del 11 todavía es el 10 en Argentina.
    expect(argentinaDayStart(new Date("2026-10-11T01:00:00Z")).toISOString()).toBe("2026-10-10T03:00:00.000Z");
  });

  describe("buildRanking", () => {
    const row = (id: string, efficiencyPct: number, timeUsedSec: number, minute = 0): RankingRow => ({
      id,
      name: id.toUpperCase(),
      efficiencyPct,
      timeUsedSec,
      endedAt: new Date(Date.UTC(2026, 9, 10, 15, minute)),
    });

    it("ordena por eficiencia, después por tiempo, después por quién terminó antes", () => {
      const r = buildRanking([row("c", 90, 30), row("a", 100, 40), row("b", 100, 20), row("d", 90, 30, -5)]);
      expect(r.entries.map((e) => e.id)).toEqual(["b", "a", "d", "c"]);
      expect(r.entries.map((e) => e.position)).toEqual([1, 2, 3, 4]);
    });

    it("si la partida quedó fuera del top 7, reemplaza a la séptima con su puesto real", () => {
      const rows = Array.from({ length: 10 }, (_, i) => row(`p${i}`, 100 - i, 30));
      const r = buildRanking(rows, "p9");
      expect(r.total).toBe(10);
      expect(r.position).toBe(10);
      expect(r.entries).toHaveLength(7);
      expect(r.entries[6]).toMatchObject({ id: "p9", position: 10, mine: true });
    });

    it("sin la partida en el ranking, position es null", () => {
      expect(buildRanking([row("a", 100, 30)], "otra").position).toBeNull();
    });
  });
});
