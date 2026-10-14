import { OfferStatus } from "@movo/shared/dist/types/offer";
import {
  estimateReceivedArs,
  getClientCommissionRate,
  getClientMpTransactionFeeRate,
} from "../src/lib/commission-config";
import { receivedAmountLabel } from "../src/lib/offer-format";

describe("commission-config (MOVO-225)", () => {
  const originalMovo = process.env.EXPO_PUBLIC_MOVO_COMMISSION_RATE;
  const originalMp = process.env.EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE;

  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  afterEach(() => {
    restore("EXPO_PUBLIC_MOVO_COMMISSION_RATE", originalMovo);
    restore("EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE", originalMp);
  });

  it("cae al default si la tasa de MP no es numérica, en vez de mostrar $NaN", () => {
    process.env.EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE = "4,99%";
    expect(getClientMpTransactionFeeRate()).toBe(0.0499);
    expect(Number.isFinite(estimateReceivedArs(1000, 1150))).toBe(true);
  });

  it("cae al default si la comisión de Movo no es numérica", () => {
    process.env.EXPO_PUBLIC_MOVO_COMMISSION_RATE = "quince";
    expect(getClientCommissionRate()).toBe(0.15);
  });

  it("usa la tasa de MP configurada para el estimado de lo que recibís", () => {
    process.env.EXPO_PUBLIC_MP_TRANSACTION_FEE_RATE = "0.04";
    expect(estimateReceivedArs(1000, 1150)).toBe(954);
  });
});

describe("receivedAmountLabel (MOVO-225)", () => {
  it("promete un cobro solo para ofertas pendientes o aceptadas", () => {
    expect(receivedAmountLabel(OfferStatus.PENDING)).toBe("Recibís aprox.");
    expect(receivedAmountLabel(OfferStatus.ACCEPTED)).toBe(
      "Vas a recibir aprox.",
    );
    for (const status of [
      OfferStatus.REJECTED,
      OfferStatus.WITHDRAWN,
      OfferStatus.EXPIRED,
      OfferStatus.SUPERSEDED,
      OfferStatus.SHIPMENT_CANCELLED,
      OfferStatus.ASSIGNMENT_LAPSED,
    ]) {
      expect(receivedAmountLabel(status)).toBe("Habrías recibido aprox.");
    }
  });
});
