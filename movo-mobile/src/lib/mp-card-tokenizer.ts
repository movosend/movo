/**
 * Captura de tarjeta en el dispositivo (MOVO-101, DD-039). Decisión de captura: formulario
 * propio contra la API pública de Mercado Pago con la `public_key` de Movo, igual que la
 * prueba del 13/10. Bricks es un SDK web y no soporta cuentas de prueba; un WebView sumaba
 * una página propia sin ganar nada. Número y CVV viajan solo de acá a MP: al backend de
 * Movo va únicamente el `token` (`POST /payments/cards`). MOVO-269 reusa este módulo para
 * pedir el token con el CVV al pagar.
 *
 * Nada de este módulo loguea ni persiste los datos de la tarjeta.
 */

const MP_API_URL = "https://api.mercadopago.com/v1";
const TIMEOUT_MS = 15_000;

/** Lo que MP sabe de una tarjeta por sus primeros 6 dígitos (BIN). */
export interface CardBinInfo {
  /** `payment_method.id` (`visa`, `debvisa`, `master`, `amex`...). Lo pide `POST /payments/cards`. */
  paymentMethodId: string;
  /** `credit_card`, `debit_card` o `prepaid_card`. */
  paymentType: string | null;
  issuerName: string | null;
  /** Largo del número; `null` si MP no lo informa (se usa el de la marca). */
  cardNumberLength: number | null;
  securityCodeLength: number | null;
}

export interface CardTokenInput {
  cardNumber: string;
  expMonth: number;
  /** Cuatro dígitos (2031). */
  expYear: number;
  securityCode: string;
  holderName: string;
  docType: "DNI";
  docNumber: string;
}

/**
 * Motivo de un rechazo de MP al tokenizar, ya traducido a algo que el usuario pueda
 * corregir. `field` marca el dato a revisar (el wizard vuelve a ese paso).
 */
export type CardTokenFailure =
  | { reason: "invalid_number"; field: "number" }
  | { reason: "invalid_expiration"; field: "expiration" }
  | { reason: "invalid_security_code"; field: "security_code" }
  | { reason: "invalid_holder"; field: "holder" }
  | { reason: "invalid_document"; field: "document" }
  | { reason: "network"; field: null }
  | { reason: "unknown"; field: null };

export class CardTokenError extends Error {
  constructor(readonly failure: CardTokenFailure) {
    super(`MP rechazó la tarjeta: ${failure.reason}`);
    this.name = "CardTokenError";
  }
}

// Códigos de `cause` que documenta MP para `POST /v1/card_tokens`.
const CAUSE_FAILURES: Record<string, CardTokenFailure> = {
  "205": { reason: "invalid_number", field: "number" },
  E301: { reason: "invalid_number", field: "number" },
  "208": { reason: "invalid_expiration", field: "expiration" },
  "209": { reason: "invalid_expiration", field: "expiration" },
  "325": { reason: "invalid_expiration", field: "expiration" },
  "326": { reason: "invalid_expiration", field: "expiration" },
  E203: { reason: "invalid_security_code", field: "security_code" },
  E302: { reason: "invalid_security_code", field: "security_code" },
  "221": { reason: "invalid_holder", field: "holder" },
  "316": { reason: "invalid_holder", field: "holder" },
  "212": { reason: "invalid_document", field: "document" },
  "213": { reason: "invalid_document", field: "document" },
  "214": { reason: "invalid_document", field: "document" },
  "322": { reason: "invalid_document", field: "document" },
  "323": { reason: "invalid_document", field: "document" },
  "324": { reason: "invalid_document", field: "document" },
};

export function failureFromMpBody(body: unknown): CardTokenFailure {
  const cause = (body as { cause?: unknown } | null)?.cause;
  if (Array.isArray(cause)) {
    for (const item of cause) {
      const code = (item as { code?: unknown } | null)?.code;
      if ((typeof code === "string" || typeof code === "number") && CAUSE_FAILURES[String(code)]) {
        return CAUSE_FAILURES[String(code)];
      }
    }
  }
  return { reason: "unknown", field: null };
}

async function mpFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new CardTokenError({ reason: "network", field: null });
  } finally {
    clearTimeout(timer);
  }
}

interface MpPaymentMethodResult {
  id?: unknown;
  payment_type_id?: unknown;
  issuer?: { name?: unknown } | null;
  settings?: { card_number?: { length?: unknown }; security_code?: { length?: unknown } }[];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

/**
 * `GET /v1/payment_methods/search` con el BIN. `null` si MP no reconoce la tarjeta; el
 * wizard sigue igual (sin banco detectado), porque el rechazo real lo da el token.
 */
export async function lookupBin(publicKey: string, bin: string): Promise<CardBinInfo | null> {
  const url = `${MP_API_URL}/payment_methods/search?public_key=${encodeURIComponent(publicKey)}&bins=${encodeURIComponent(bin)}`;
  const response = await mpFetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const body = (await response.json()) as { results?: MpPaymentMethodResult[] };
  const result = body.results?.find((r) => typeof r.id === "string");
  if (!result || typeof result.id !== "string") return null;
  const settings = result.settings?.[0];
  return {
    paymentMethodId: result.id,
    paymentType: stringOrNull(result.payment_type_id),
    issuerName: stringOrNull(result.issuer?.name),
    cardNumberLength: numberOrNull(settings?.card_number?.length),
    securityCodeLength: numberOrNull(settings?.security_code?.length),
  };
}

/**
 * `POST /v1/card_tokens`: token de un solo uso para guardar la tarjeta. Tira
 * `CardTokenError` con el motivo si MP la rechaza.
 */
export async function createCardToken(publicKey: string, input: CardTokenInput): Promise<string> {
  return postCardToken(publicKey, {
    card_number: input.cardNumber,
    expiration_month: input.expMonth,
    expiration_year: input.expYear,
    security_code: input.securityCode,
    cardholder: {
      name: input.holderName,
      identification: { type: input.docType, number: input.docNumber },
    },
  });
}

export interface SavedCardTokenInput {
  /** `mpCardId` de la tarjeta guardada en la cuenta de Movo (`SavedCard.mpCardId`). */
  cardId: string;
  securityCode: string;
}

/**
 * `POST /v1/card_tokens` con `card_id` + CVV (MOVO-269, DD-039): token de un solo uso para
 * pagar con una tarjeta guardada. `publicKey` es la **del transportista** del envío
 * (`carrierPublicKey` de `GET /shipments/:id/funding`), no la de Movo: MP exige que el token
 * pertenezca a la cuenta que cobra. El CVV viaja solo de acá a MP.
 */
export async function createSavedCardToken(publicKey: string, input: SavedCardTokenInput): Promise<string> {
  return postCardToken(publicKey, { card_id: input.cardId, security_code: input.securityCode });
}

async function postCardToken(publicKey: string, payload: Record<string, unknown>): Promise<string> {
  const response = await mpFetch(`${MP_API_URL}/card_tokens?public_key=${encodeURIComponent(publicKey)}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const id = (body as { id?: unknown } | null)?.id;
  if (response.ok && typeof id === "string") return id;
  throw new CardTokenError(response.ok ? { reason: "unknown", field: null } : failureFromMpBody(body));
}
