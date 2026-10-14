/**
 * MOVO-100 (ADR-039): contrato de las tarjetas guardadas del emisor, que expone
 * `movo-svc-payments` bajo `/payments/cards` y consumen `movo-mobile` (MOVO-101/269).
 * La tarjeta vive en un customer de la cuenta de Movo S.A. en Mercado Pago; acá solo
 * viajan ids de MP y metadatos de display, nunca número, CVV ni `card_token`.
 */

/** Tope de tarjetas vivas por usuario (`409 CARD_LIMIT_REACHED`). */
export const MAX_SAVED_CARDS_PER_USER = 10;

/** Largo máximo del nombre de referencia (`alias`). */
export const SAVED_CARD_ALIAS_MAX_LENGTH = 40;

export interface SavedCard {
  /** Id de la tarjeta en Movo (no el de MP). */
  id: string;
  /**
   * Id de la tarjeta en MP. El mobile lo necesita para pedir el token con el CVV
   * (`POST /v1/card_tokens`); sin el CVV no sirve para pagar.
   */
  mpCardId: string;
  /** Nombre de referencia que puso el usuario ("Visa del trabajo"); es de Movo, no va a MP. */
  alias: string | null;
  /** `payment_method.id` de MP (`visa`, `master`, ...). */
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  /**
   * Banco emisor según MP (`issuer.name`, "Banco Galicia"), solo para mostrar. `null` en
   * tarjetas guardadas antes de MOVO-101 o si MP no lo informa.
   */
  issuerName: string | null;
  /** `payment_type_id` de MP: `credit_card`, `debit_card` o `prepaid_card`; `null` si no vino. */
  paymentType: string | null;
  isDefault: boolean;
  createdAt: string;
}

/** `GET /payments/cards/checkout-data`: con qué `public_key` se tokeniza la tarjeta al guardarla. */
export interface CardsCheckoutDataResponse {
  publicKey: string;
}

/** `POST /payments/cards`. `cardToken` es de un solo uso, generado en el dispositivo. */
export interface CreateSavedCardRequest {
  cardToken: string;
  paymentMethodId?: string;
  alias?: string | null;
}

/** `PATCH /payments/cards/:id`. `null` o vacío borra el alias. */
export interface UpdateSavedCardRequest {
  alias: string | null;
}
