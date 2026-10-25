import { describe, it, expect } from "vitest";
import { isUserDebtOverdue } from "../src/domain/user-debt";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-30T12:00:00.000Z");
const OVERDUE_DAYS = 14;

function ageDays(days: number, extraMs = 0): string {
  return new Date(NOW.getTime() - days * DAY_MS - extraMs).toISOString();
}

describe("isUserDebtOverdue (MOVO-313, DD-044)", () => {
  it("deuda sin saldar hace más de 14 días: vencida", () => {
    expect(isUserDebtOverdue({ balanceArs: 4200, oldestUnpaidAt: ageDays(15) }, NOW, OVERDUE_DAYS)).toBe(true);
  });

  it("deuda reciente: no está vencida", () => {
    expect(isUserDebtOverdue({ balanceArs: 4200, oldestUnpaidAt: ageDays(3) }, NOW, OVERDUE_DAYS)).toBe(false);
  });

  it("a los 14 días justos todavía no está vencida: el umbral es estricto (más de 14)", () => {
    expect(isUserDebtOverdue({ balanceArs: 4200, oldestUnpaidAt: ageDays(14) }, NOW, OVERDUE_DAYS)).toBe(false);
    expect(isUserDebtOverdue({ balanceArs: 4200, oldestUnpaidAt: ageDays(14, 1) }, NOW, OVERDUE_DAYS)).toBe(true);
  });

  it("sin umbral de monto: una deuda de un peso vencida bloquea igual", () => {
    expect(isUserDebtOverdue({ balanceArs: 1, oldestUnpaidAt: ageDays(30) }, NOW, OVERDUE_DAYS)).toBe(true);
  });

  it("respeta el umbral configurado", () => {
    const debt = { balanceArs: 4200, oldestUnpaidAt: ageDays(5) };

    expect(isUserDebtOverdue(debt, NOW, 7)).toBe(false);
    expect(isUserDebtOverdue(debt, NOW, 3)).toBe(true);
  });

  it("sin deuda o con saldo a favor: nada vencido, aunque haya una fecha vieja", () => {
    expect(isUserDebtOverdue({ balanceArs: 0, oldestUnpaidAt: null }, NOW, OVERDUE_DAYS)).toBe(false);
    expect(isUserDebtOverdue({ balanceArs: -500, oldestUnpaidAt: null }, NOW, OVERDUE_DAYS)).toBe(false);
    expect(isUserDebtOverdue({ balanceArs: -500, oldestUnpaidAt: ageDays(60) }, NOW, OVERDUE_DAYS)).toBe(false);
  });

  it("saldo positivo sin fecha (movimiento ya settled sin contrapartida): no se puede probar que es reciente, bloquea", () => {
    expect(isUserDebtOverdue({ balanceArs: 4200, oldestUnpaidAt: null }, NOW, OVERDUE_DAYS)).toBe(true);
  });

  it("fecha ilegible con deuda: falla cerrado", () => {
    expect(isUserDebtOverdue({ balanceArs: 4200, oldestUnpaidAt: "basura" }, NOW, OVERDUE_DAYS)).toBe(true);
  });
});
