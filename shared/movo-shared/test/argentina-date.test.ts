import { describe, expect, it } from "vitest";
import { toArgentinaCalendarDateString } from "../src/utils/argentina-date";

describe("toArgentinaCalendarDateString", () => {
  it("acepta un Date", () => {
    expect(toArgentinaCalendarDateString(new Date("2026-09-09T13:00:00.000Z"))).toBe("2026-09-09");
  });

  it("acepta un string ISO", () => {
    expect(toArgentinaCalendarDateString("2026-09-09T13:00:00.000Z")).toBe("2026-09-09");
  });

  it("un instante de madrugada UTC cae el día anterior en Argentina (UTC-3)", () => {
    // 2026-09-10T02:00:00Z es 2026-09-09 23:00 en Argentina.
    expect(toArgentinaCalendarDateString("2026-09-10T02:00:00.000Z")).toBe("2026-09-09");
  });

  it("un instante justo en el límite del offset (03:00 UTC) ya cae en el día siguiente en Argentina", () => {
    // 2026-09-10T03:00:00Z es exactamente 2026-09-10T00:00:00 en Argentina.
    expect(toArgentinaCalendarDateString("2026-09-10T03:00:00.000Z")).toBe("2026-09-10");
  });

  it("padea mes y día de un dígito con cero a la izquierda", () => {
    expect(toArgentinaCalendarDateString("2026-01-05T13:00:00.000Z")).toBe("2026-01-05");
  });
});
