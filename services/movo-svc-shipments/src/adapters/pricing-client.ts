import { PriceCalculationMethod, QuoteRequest, QuoteResponse } from "@movo/shared";

/**
 * Cliente HTTP hacia `POST /quote` de `movo-svc-pricing-logistics` (MOVO-82) —
 * mismo patrón que `users-client.ts` (`fetch` nativo + `AbortSignal.timeout`), pero
 * a diferencia de ese cliente **nunca lanza**: acá el fallback (AC6 del ticket) es un
 * resultado de negocio válido ("precio a estimar"), no un fallo de transporte que
 * deba abortar `createShipment`. Cualquier error de red, timeout, respuesta no-ok, o
 * datos de entrada incompletos (AC7) devuelve el mismo shape con campos `null`.
 */
export interface QuoteInput {
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  packageType?: QuoteRequest["packageType"];
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  urgent?: boolean;
}

export interface QuoteResult {
  suggestedPriceArs: number | null;
  calculationMethod: PriceCalculationMethod | null;
}

export interface PricingClient {
  getQuote(input: QuoteInput): Promise<QuoteResult>;
}

export interface PricingClientConfig {
  PRICING_SERVICE_URL: string;
}

// Más corto que los 5000ms de `users-client.ts`: acá degradar a "precio a estimar" es
// gratis (AC6), así que no vale la pena hacer esperar la creación del envío tanto
// tiempo antes de resolver al fallback.
const REQUEST_TIMEOUT_MS = 3000;

const NO_QUOTE: QuoteResult = { suggestedPriceArs: null, calculationMethod: null };

const REQUIRED_NUMERIC_FIELDS = [
  "weightKg",
  "lengthCm",
  "widthCm",
  "heightCm",
  "originLat",
  "originLng",
  "destinationLat",
  "destinationLng",
] as const;

/**
 * AC7: si falta peso, dimensiones o coordenadas, no se llama al servicio. Con el
 * schema actual de `createShipmentBody` estos campos siempre llegan completos a
 * `createShipment`, así que esta rama no se ejercita hoy vía `POST /shipments` -- es
 * el contrato correcto para cuando MOVO-83 (el wizard mobile, bloqueado por este
 * ticket) reuse este mismo cliente desde un paso con datos todavía parciales.
 */
type CompleteQuoteInput = QuoteInput &
  Required<Pick<QuoteInput, (typeof REQUIRED_NUMERIC_FIELDS)[number] | "packageType">>;

function isCompleteQuoteInput(input: QuoteInput): input is CompleteQuoteInput {
  return (
    REQUIRED_NUMERIC_FIELDS.every((field) => Number.isFinite(input[field])) &&
    input.packageType !== undefined
  );
}

export function createPricingClient(config: PricingClientConfig): PricingClient {
  return {
    async getQuote(input: QuoteInput): Promise<QuoteResult> {
      if (!isCompleteQuoteInput(input)) {
        return NO_QUOTE;
      }

      const request: QuoteRequest = {
        originLat: input.originLat,
        originLng: input.originLng,
        destinationLat: input.destinationLat,
        destinationLng: input.destinationLng,
        weightKg: input.weightKg,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        packageType: input.packageType,
        urgent: input.urgent ?? false,
      };

      let response: Response;
      try {
        response = await fetch(`${config.PRICING_SERVICE_URL}/quote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // Red caída o timeout -- mismo criterio de fallback que una respuesta no-ok.
        return NO_QUOTE;
      }

      if (!response.ok) {
        return NO_QUOTE;
      }

      const data = (await response.json()) as QuoteResponse;
      return { suggestedPriceArs: data.suggestedPriceArs, calculationMethod: data.calculationMethod };
    },
  };
}
