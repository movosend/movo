import { describe, expect, it } from "vitest";
import { csvFileName, escapeCsvCell, toCsv } from "../src/utils/csv";

describe("helper de CSV (MOVO-342)", () => {
  describe("escapeCsvCell", () => {
    it.each(["=SUM(A1:A2)", "+54 351", "-1+1", "@cmd", "\t=1", "\r=1"])("neutraliza una fórmula que empieza con %j", (raw) => {
      const cell = escapeCsvCell(raw);
      expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
    });

    it("un número negativo sigue siendo número (no puede ser una fórmula)", () => {
      expect(escapeCsvCell(-5)).toBe("-5");
      expect(escapeCsvCell(12.5)).toBe("12.5");
      expect(escapeCsvCell(Number.NaN)).toBe("");
    });

    it("comillas RFC 4180 con coma, comilla o salto de línea", () => {
      expect(escapeCsvCell('dijo "hola", chau')).toBe('"dijo ""hola"", chau"');
      expect(escapeCsvCell("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
      expect(escapeCsvCell("=1,2")).toBe(`"'=1,2"`);
    });

    it("vacíos y booleanos", () => {
      expect(escapeCsvCell(null)).toBe("");
      expect(escapeCsvCell(undefined)).toBe("");
      expect(escapeCsvCell(true)).toBe("true");
      expect(escapeCsvCell("texto común")).toBe("texto común");
    });
  });

  describe("toCsv", () => {
    const columns = [
      { header: "nombre", value: (row: { name: string; n: number }) => row.name },
      { header: "n", value: (row: { name: string; n: number }) => row.n },
    ];

    it("arma BOM, encabezado y una línea por fila con CRLF", () => {
      expect(toCsv(columns, [{ name: "Ana", n: 1 }, { name: "=mal", n: -2 }])).toBe("﻿nombre,n\r\nAna,1\r\n'=mal,-2\r\n");
    });

    it("sin filas deja solo el encabezado", () => {
      expect(toCsv(columns, [])).toBe("﻿nombre,n\r\n");
    });
  });

  it("csvFileName usa la fecha de Argentina: a las 23:30 del 27 todavía es 27 aunque en UTC sea 28", () => {
    expect(csvFileName("movo-bitacora", new Date("2026-10-28T02:30:00.000Z"))).toBe("movo-bitacora_2026-10-27.csv");
  });
});
