import { isPickupWindowExpired } from "../src/lib/shipment-format";

describe("isPickupWindowExpired", () => {
  it("una ventana de retiro que ya pasó está vencida", () => {
    const now = new Date(2026, 8, 3, 12, 0); // 3 de septiembre de 2026, 12:00
    expect(isPickupWindowExpired("2026-08-30", "22:00", now)).toBe(true);
  });

  it("una ventana de retiro futura no está vencida", () => {
    const now = new Date(2026, 8, 3, 12, 0);
    expect(isPickupWindowExpired("2026-09-10", "12:00", now)).toBe(false);
  });

  it("el mismo día, todavía dentro de la ventana, no está vencida", () => {
    const now = new Date(2026, 8, 3, 10, 0);
    expect(isPickupWindowExpired("2026-09-03", "12:00", now)).toBe(false);
  });

  it("el mismo día, justo después de que cierra la ventana, está vencida", () => {
    const now = new Date(2026, 8, 3, 12, 1);
    expect(isPickupWindowExpired("2026-09-03", "12:00", now)).toBe(true);
  });

  it("una fecha con formato inválido nunca se considera vencida (fail-safe: no oculta de más)", () => {
    const now = new Date(2026, 8, 3, 12, 0);
    expect(isPickupWindowExpired("fecha-invalida", "12:00", now)).toBe(false);
  });
});
