import { toArgentinaCalendarDateString } from "@movo/shared";

export { CSV_MAX_ROWS } from "@movo/shared";

/**
 * MOVO-342 (ADR-025): CSV de los reportes del panel, generado en el backend. Lo reusan la bitácora, el reporte de
 * disputas (MOVO-344) y las métricas (MOVO-35).
 */

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

/**
 * Caracteres con los que una planilla (Excel, Sheets, LibreOffice) interpreta una celda como fórmula. Tab y retorno
 * de carro también: algunas planillas los saltean y leen la fórmula que sigue (OWASP, "CSV Injection").
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escapa una celda. Un texto que empieza como fórmula lleva un `'` adelante (la planilla lo muestra como texto); un
 * número no, porque no puede ser una fórmula y un `-5` tiene que seguir siendo un número. Después, comillas RFC 4180
 * si hace falta.
 */
export function escapeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Arma el CSV completo: BOM UTF-8 (para que Excel lea bien los acentos), encabezado y una línea por fila, con CRLF (RFC 4180). */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((column) => escapeCsvCell(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => escapeCsvCell(column.value(row))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Nombre del archivo: `<base>_YYYY-MM-DD.csv`, con la fecha de Argentina. */
export function csvFileName(base: string, at: Date = new Date()): string {
  return `${base}_${toArgentinaCalendarDateString(at)}.csv`;
}
