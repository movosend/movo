import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { CardTokenError } from "../src/lib/mp-card-tokenizer";
import {
  cvvLengthFor,
  defaultPayableCard,
  formatPayTimeLeft,
  payErrorMessage,
  rejectionCopy,
  unavailableKind,
} from "../src/lib/pay-shipment-format";

const card = (over: Partial<SavedCard>): SavedCard => ({
  id: "c",
  mpCardId: "mp",
  alias: null,
  brand: "visa",
  last4: "4242",
  expMonth: 11,
  expYear: 2099,
  issuerName: null,
  paymentType: null,
  isDefault: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("pay-shipment-format (MOVO-269)", () => {
  it("el código es de 4 dígitos en Amex y de 3 en el resto (AC2)", () => {
    expect(cvvLengthFor({ brand: "amex" })).toBe(4);
    expect(cvvLengthFor({ brand: "visa" })).toBe(3);
    expect(cvvLengthFor({ brand: "master" })).toBe(3);
  });

  it("preselecciona la predeterminada vigente; si está vencida, la primera vigente", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const a = card({ id: "a", isDefault: true });
    const b = card({ id: "b" });
    expect(defaultPayableCard([b, a], now)?.id).toBe("a");
    const expiredDefault = card({ id: "a", isDefault: true, expYear: 2025 });
    expect(defaultPayableCard([expiredDefault, b], now)?.id).toBe("b");
    expect(defaultPayableCard([expiredDefault], now)).toBeNull();
    expect(defaultPayableCard([], now)).toBeNull();
  });

  it("formatea el tiempo que queda para pagar", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(formatPayTimeLeft("2026-10-15T11:00:00Z", now)).toBe("Quedan 23 h");
    expect(formatPayTimeLeft("2026-10-14T12:30:00Z", now)).toBe("Quedan 30 min");
    expect(formatPayTimeLeft("2026-10-20T12:00:00Z", now)).toBe("Quedan 6 días");
    expect(formatPayTimeLeft("2026-10-14T11:00:00Z", now)).toBeNull();
    expect(formatPayTimeLeft(null, now)).toBeNull();
  });

  it("cada motivo de rechazo tiene su copy y solo el CVV resalta el campo (AC4)", () => {
    expect(rejectionCopy("invalid_data", "$18.400", "Visa •••• 3704")).toMatchObject({
      title: "Revisá el código de seguridad",
      field: "cvv",
      suggestOtherCard: false,
    });
    expect(rejectionCopy("insufficient_funds", "$18.400", "Visa •••• 3704")).toMatchObject({
      title: "Tu tarjeta no tiene fondos suficientes",
      field: null,
      suggestOtherCard: true,
    });
    expect(rejectionCopy("insufficient_funds", "$18.400", "Visa •••• 3704").body).toContain("Visa •••• 3704");
    expect(rejectionCopy("card_rejected", "$18.400", "x")).toMatchObject({ field: null, suggestOtherCard: true });
    expect(rejectionCopy("platform_error", "$18.400", "x").title).toBe("No pudimos reservar los fondos");
  });

  it("un token rechazado por MP pide revisar el código; sin red lo dice", () => {
    const rejected = new CardTokenError({ reason: "invalid_security_code", field: "security_code" });
    expect(payErrorMessage({ kind: "token_error", error: rejected })).toMatchObject({ field: "cvv" });
    const network = new CardTokenError({ reason: "network", field: null });
    expect(payErrorMessage({ kind: "token_error", error: network })).toMatchObject({
      title: "No pudimos conectarnos con Mercado Pago",
      field: null,
    });
  });

  it("si el transportista desvinculó Mercado Pago, el emisor no ve el mensaje del transportista", () => {
    const error = new ApiError(409, "CARRIER_MP_ACCOUNT_NOT_LINKED", "x");
    const copy = payErrorMessage({ kind: "error", error });
    expect(copy.body).toContain("El transportista no puede recibir pagos");
    expect(copy.body).not.toContain("vincular tu cuenta");
  });

  it("qué se muestra cuando ya no se puede pagar depende del estado del envío (AC7)", () => {
    expect(unavailableKind(ShipmentStatus.PUBLISHED)).toBe("released");
    expect(unavailableKind(ShipmentStatus.CANCELLED)).toBe("released");
    expect(unavailableKind(ShipmentStatus.ASSIGNED)).toBe("already_funded");
    expect(unavailableKind(ShipmentStatus.IN_TRANSIT)).toBe("already_funded");
    expect(unavailableKind(ShipmentStatus.ASSIGNED_UNFUNDED)).toBe("unavailable");
    expect(unavailableKind(undefined)).toBe("unavailable");
  });
});
