import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor } from "../src/utils/cursor";

describe("cursor opaco de paginación (compartido por chat y soporte)", () => {
  const row = { createdAt: new Date("2026-10-21T12:00:00.123Z"), id: "44444444-4444-4444-8444-444444444444" };

  it("ida y vuelta conserva el instante con precisión de ms y el id", () => {
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
  });

  it("mantiene el formato histórico: base64 de `ISO|id`", () => {
    expect(Buffer.from(encodeCursor(row), "base64").toString("utf8")).toBe(`2026-10-21T12:00:00.123Z|${row.id}`);
  });

  it.each([
    ["texto cualquiera", "basura"],
    ["sin id", Buffer.from("2026-10-21T12:00:00.123Z|", "utf8").toString("base64")],
    ["id que no es un UUID", Buffer.from("2026-10-21T12:00:00.123Z|1; DROP TABLE x", "utf8").toString("base64")],
    ["fecha inválida", Buffer.from(`no-es-fecha|${row.id}`, "utf8").toString("base64")],
  ])("rechaza un cursor inválido (%s)", (_name, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});
