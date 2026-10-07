import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { PriceCalculationMethod, ShipmentQuoteRequest } from "@movo/shared";

/**
 * Vida de una cotización congelada (MOVO-255, ADR-028). El resumen es el último paso
 * del wizard, así que alcanza para confirmar; si el emisor se va y vuelve más tarde,
 * recotiza. Constante y no env var a propósito: es una decisión de producto, no algo
 * que cambie por ambiente.
 */
export const SHIPMENT_QUOTE_TTL_SECONDS = 15 * 60;

const quoteKey = (quoteId: string) => `shipment_quote:${quoteId}`;

export interface FrozenQuote {
  userId: string;
  suggestedPriceArs: number;
  highDemand: boolean | null;
  calculationMethod: PriceCalculationMethod;
  fingerprint: string;
}

export type ConsumeQuoteResult =
  | { status: "ok"; quote: FrozenQuote }
  | { status: "expired" }
  | { status: "mismatch" };

export interface QuoteStore {
  save(quote: FrozenQuote): Promise<{ quoteId: string; expiresAt: Date }>;
  consume(quoteId: string, userId: string, fingerprint: string): Promise<ConsumeQuoteResult>;
}

/**
 * Hash de los datos que afectan el precio. Las coordenadas se redondean a 6 decimales
 * (~11 cm) para que el mismo punto serializado con otra cola de float no dé un falso
 * `QUOTE_MISMATCH`.
 */
export function quoteFingerprint(input: ShipmentQuoteRequest): string {
  const coord = (value: number) => Number(value.toFixed(6));
  const canonical = JSON.stringify([
    input.packageType,
    input.weightKg,
    input.lengthCm,
    input.widthCm,
    input.heightCm,
    coord(input.pickupLat),
    coord(input.pickupLng),
    coord(input.deliveryLat),
    coord(input.deliveryLng),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Consume la cotización de forma atómica, pero solo si es del usuario y coincide el
 * fingerprint: un `GETDEL` a secas dejaría que un `quoteId` ajeno o mandado con otros
 * datos queme la cotización del dueño. Una cotización de otro usuario se informa como
 * vencida, para no revelar que el id existe. Ante un `mismatch` no se borra: el
 * dueño todavía puede usarla con los datos que cotizó.
 */
const CONSUME_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'expired'} end
local quote = cjson.decode(raw)
if quote.userId ~= ARGV[1] then return {'expired'} end
if quote.fingerprint ~= ARGV[2] then return {'mismatch'} end
redis.call('DEL', KEYS[1])
return {'ok', raw}
`;

export function createQuoteStore(redis: Redis, now: () => Date = () => new Date()): QuoteStore {
  return {
    async save(quote) {
      const quoteId = randomUUID();
      await redis.set(quoteKey(quoteId), JSON.stringify(quote), "EX", SHIPMENT_QUOTE_TTL_SECONDS);
      return { quoteId, expiresAt: new Date(now().getTime() + SHIPMENT_QUOTE_TTL_SECONDS * 1000) };
    },

    async consume(quoteId, userId, fingerprint) {
      const [status, raw] = (await redis.eval(CONSUME_SCRIPT, 1, quoteKey(quoteId), userId, fingerprint)) as [
        string,
        string?,
      ];
      if (status === "ok" && raw) {
        return { status: "ok", quote: JSON.parse(raw) as FrozenQuote };
      }
      return status === "mismatch" ? { status: "mismatch" } : { status: "expired" };
    },
  };
}
