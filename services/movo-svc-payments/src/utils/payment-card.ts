import type { PaymentSnapshot } from "../adapters/mercadopago-client";

/** Últimos 4 de una tarjeta: exactamente 4 dígitos. */
const CARD_LAST4_PATTERN = /^\d{4}$/;
/** `payment_method_id` de MP (`visa`, `master`, `debvisa`, ...): corto y alfanumérico. */
const CARD_BRAND_PATTERN = /^[a-z0-9_]{1,32}$/i;

/** Marca y últimos 4 de la tarjeta de un pago, tal como van a las columnas de `payments.holds`. */
export interface PaymentCard {
  cardLast4?: string;
  cardBrand?: string;
}

/**
 * MOVO-302: marca y últimos 4 de la tarjeta con que se pagó, solo si MP los informa y tienen la
 * forma esperada: lo que no cumple se descarta en vez de persistirse o inventarse (nunca se deriva
 * nada del token ni del medio de pago que mandó el mobile). Lo que MP no trae no aparece en el
 * resultado, así que usarlo como parche no pisa un dato previo.
 *
 * Es la única puerta de esos datos: la usan todos los caminos que leen un pago de MP (crear,
 * consultar, adoptar, webhook y captura).
 */
export function cardFromPayment(payment: PaymentSnapshot): PaymentCard {
  const last4 = payment.card?.last_four_digits;
  const brand = payment.payment_method_id;
  return {
    ...(typeof last4 === "string" && CARD_LAST4_PATTERN.test(last4) ? { cardLast4: last4 } : {}),
    ...(typeof brand === "string" && CARD_BRAND_PATTERN.test(brand) ? { cardBrand: brand.toLowerCase() } : {}),
  };
}

/**
 * De lo que informa el pago, solo lo que la fila todavía no tiene: completar una tarjeta que faltaba
 * sin reescribir (ni tocar el estado) cuando ya estaba. Vacío si no hay nada para completar.
 */
export function missingCardFields(
  current: { cardLast4: string | null; cardBrand: string | null },
  payment: PaymentSnapshot
): PaymentCard {
  const card = cardFromPayment(payment);
  return {
    ...(card.cardLast4 && !current.cardLast4 ? { cardLast4: card.cardLast4 } : {}),
    ...(card.cardBrand && !current.cardBrand ? { cardBrand: card.cardBrand } : {}),
  };
}
