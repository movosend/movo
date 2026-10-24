import { describe, it, expect } from "vitest";
import { isRetryableCaptureFailure, nextRetryAt, parseRetryDelays } from "../src/modules/settlements/capture-failure";

describe("isRetryableCaptureFailure (AC4 de MOVO-213)", () => {
  it.each([
    ["error de red o timeout (sin respuesta de MP)", { reason: "provider_error" as const }],
    ["5xx de MP", { reason: "provider_error" as const, mpHttpStatus: 503 }],
    ["429 por límite de pedidos", { reason: "provider_error" as const, mpHttpStatus: 429 }],
    ["408 timeout", { reason: "provider_error" as const, mpHttpStatus: 408 }],
    ["estado de pago inesperado tras capturar", { reason: "unexpected_payment_status" as const }],
  ])("%s se reintenta", (_name, input) => {
    expect(isRetryableCaptureFailure(input)).toBe(true);
  });

  it.each([
    ["hold vencido o cancelado", { reason: "hold_expired" as const }],
    ["cuenta del transportista desvinculada o credenciales rechazadas", { reason: "carrier_account_unavailable" as const }],
    ["rechazo 400 del pedido", { reason: "provider_error" as const, mpHttpStatus: 400 }],
    ["404 del pago", { reason: "provider_error" as const, mpHttpStatus: 404 }],
    ["409 conflicto", { reason: "provider_error" as const, mpHttpStatus: 409 }],
  ])("%s escala sin reintentar", (_name, input) => {
    expect(isRetryableCaptureFailure(input)).toBe(false);
  });
});

describe("nextRetryAt / parseRetryDelays", () => {
  const NOW = new Date("2026-10-22T12:00:00.000Z");

  it("con 5, 30 y 120 min: tres reintentos y después se agota", () => {
    const delays = parseRetryDelays("5,30,120");
    expect(nextRetryAt(1, NOW, delays)?.toISOString()).toBe("2026-10-22T12:05:00.000Z");
    expect(nextRetryAt(2, NOW, delays)?.toISOString()).toBe("2026-10-22T12:30:00.000Z");
    expect(nextRetryAt(3, NOW, delays)?.toISOString()).toBe("2026-10-22T14:00:00.000Z");
    expect(nextRetryAt(4, NOW, delays)).toBeNull();
  });

  it("rechaza esperas inválidas en vez de arrancar con un backoff roto", () => {
    expect(() => parseRetryDelays("5,abc")).toThrow(/SETTLEMENT_RETRY_DELAYS_MINUTES/);
    expect(() => parseRetryDelays("5,0")).toThrow();
    expect(() => parseRetryDelays("")).toThrow();
  });
});
