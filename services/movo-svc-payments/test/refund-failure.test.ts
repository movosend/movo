import { describe, it, expect } from "vitest";
import { classifyRefundError } from "../src/modules/settlements/refund-failure";

// MOVO-336: qué hace el servicio con cada error de MP al reembolsar. Un error mal clasificado mueve plata de más
// (un `failed` que en realidad se hizo, reintentado, devuelve dos veces) o de menos (un saldo insuficiente que se
// trata como rechazo deja al emisor sin la plata y sin deuda del transportista).

const info = (status: number | undefined, message = "error", causeCodes: string[] = []) => ({ status, causeCodes, message });

describe("classifyRefundError (MOVO-336)", () => {
  it.each([401, 403])("%s son credenciales rechazadas", (status) => {
    expect(classifyRefundError(info(status))).toBe("auth");
  });

  it("un 403 `insufficient permissions` es auth, no saldo insuficiente", () => {
    expect(classifyRefundError(info(403, "Insufficient permissions"))).toBe("auth");
  });

  it.each([
    "Insufficient funds to refund",
    "insufficient balance",
    "Not enough funds in the account",
    "not enough balance",
    "Saldo insuficiente para realizar la devolución",
    "Fondos insuficientes",
  ])("«%s» es saldo insuficiente", (message) => {
    expect(classifyRefundError(info(400, message))).toBe("insufficient_balance");
  });

  it.each([undefined, 408, 409, 429, 500, 502, 503])("%s no prueba que MP no reembolsó: transitorio", (status) => {
    expect(classifyRefundError(info(status))).toBe("transient");
  });

  it.each([400, 404, 422])("un %s común es un rechazo del pedido", (status) => {
    expect(classifyRefundError(info(status, "invalid refund amount", ["2000"]))).toBe("rejected");
  });

  it("el saldo insuficiente se reconoce también en un 5xx o sin status (gana sobre lo transitorio)", () => {
    expect(classifyRefundError(info(500, "Insufficient funds"))).toBe("insufficient_balance");
  });
});
