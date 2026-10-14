import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { cardBrandKey } from "./card-brand";
import { friendlyErrorMessage } from "./error-messages";
import { type CardTokenFailure, CardTokenError } from "./mp-card-tokenizer";

/**
 * Presentación de las tarjetas guardadas (MOVO-101), pura y testeable. Los textos salen del
 * prototipo de Claude Design "MOVO-112 Pagos y cobros v2".
 */

const BRAND_NAMES: Record<string, string> = { visa: "Visa", master: "Mastercard", amex: "Amex" };

/** "Visa", "Mastercard", "Amex"; otras marcas de MP capitalizadas ("cabal" → "Cabal"). */
export function cardBrandName(brand: string): string {
  const key = cardBrandKey(brand);
  if (key) return BRAND_NAMES[key];
  return brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Tarjeta";
}

/** "Visa •••• 4242". */
export function cardTitle(card: Pick<SavedCard, "brand" | "last4">): string {
  return `${cardBrandName(card.brand)} •••• ${card.last4}`;
}

/** El nombre de referencia si lo tiene; si no, marca y últimos 4. */
export function cardLabel(card: Pick<SavedCard, "alias" | "brand" | "last4">): string {
  return card.alias ?? cardTitle(card);
}

/** Una tarjeta vale hasta el último día de su mes de vencimiento. */
export function isCardExpired(card: Pick<SavedCard, "expMonth" | "expYear">, now: Date = new Date()): boolean {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return card.expYear < year || (card.expYear === year && card.expMonth < month);
}

/** "11/29". */
export function formatCardExpiry(card: Pick<SavedCard, "expMonth" | "expYear">): string {
  return `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear % 100).padStart(2, "0")}`;
}

/** "Banco Galicia" → "Galicia" (la lista usa el nombre corto, como el prototipo). */
export function shortBankName(issuerName: string): string {
  return issuerName.replace(/^banco\s+(de\s+(la\s+)?)?/i, "").trim() || issuerName;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  credit_card: "Crédito",
  debit_card: "Débito",
  prepaid_card: "Prepaga",
};

export function paymentTypeLabel(paymentType: string | null | undefined): string | null {
  return paymentType ? (PAYMENT_TYPE_LABELS[paymentType] ?? null) : null;
}

/**
 * El banco que se muestra de la tarjeta (logo y nombre), o `null` en Amex (el emisor es la
 * propia marca, igual que el prototipo) y cuando MP no lo informó.
 */
export function cardIssuerName(card: Pick<SavedCard, "brand" | "issuerName">): string | null {
  return card.issuerName && cardBrandKey(card.brand) !== "amex" ? card.issuerName : null;
}

/** "Galicia · Crédito · Vence 11/29". */
export function cardMeta(card: SavedCard, now: Date = new Date()): string {
  const issuer = cardIssuerName(card);
  const bank = issuer ? shortBankName(issuer) : null;
  const expired = isCardExpired(card, now);
  return [bank, paymentTypeLabel(card.paymentType), `${expired ? "Venció" : "Vence"} ${formatCardExpiry(card)}`]
    .filter(Boolean)
    .join(" · ");
}

/** Sub de la hoja de opciones: con alias suma marca y últimos 4 adelante. */
export function cardOptionsSub(card: SavedCard, now: Date = new Date()): string {
  return (card.alias ? `${cardTitle(card)} · ` : "") + cardMeta(card, now);
}

/** La predeterminada primero y las vencidas al final; el resto, como viene del backend. */
export function sortSavedCards(cards: SavedCard[], now: Date = new Date()): SavedCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort(
      (a, b) =>
        Number(b.card.isDefault) - Number(a.card.isDefault) ||
        Number(isCardExpired(a.card, now)) - Number(isCardExpired(b.card, now)) ||
        a.index - b.index,
    )
    .map(({ card }) => card);
}

export function hasUsableCard(cards: SavedCard[], now: Date = new Date()): boolean {
  return cards.some((card) => !isCardExpired(card, now));
}

/**
 * La que el backend marca como predeterminada si se borra `deleted`: la vigente más reciente,
 * o la más reciente si ninguna está vigente (`saved-card-repository.ts#softDelete`). Así el
 * copy de la hoja de eliminar no promete otra distinta.
 */
export function nextDefaultAfterDelete(cards: SavedCard[], deleted: SavedCard, now: Date = new Date()): SavedCard | null {
  if (!deleted.isDefault) return null;
  const rest = cards
    .filter((card) => card.id !== deleted.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rest.find((card) => !isCardExpired(card, now)) ?? rest[0] ?? null;
}

/** Título de la hoja de eliminar: `¿Eliminar "Personal"?` o `¿Eliminar Visa •••• 4242?`. */
export function deleteCardTitle(card: SavedCard): string {
  return `¿Eliminar ${card.alias ? `"${card.alias}"` : cardTitle(card)}?`;
}

export function deleteCardBody(cards: SavedCard[], card: SavedCard, now: Date = new Date()): string {
  if (!card.isDefault) return "La sacamos de tus medios de pago. Podés volver a agregarla cuando quieras.";
  const next = nextDefaultAfterDelete(cards, card, now);
  if (next && !isCardExpired(next, now)) {
    return `Es tu tarjeta predeterminada. Vamos a usar ${cardLabel(next)} en su lugar.`;
  }
  return "Es tu única tarjeta vigente. Vas a tener que agregar otra para pagar tu próximo envío.";
}

/** Texto del aviso tras guardar, como el prototipo. */
export function savedCardToast(card: SavedCard, defaultFailed = false): string {
  const base = card.alias ? `Guardamos "${card.alias}"` : `Guardamos tu ${cardTitle(card)}`;
  if (defaultFailed) return `${base}, pero no pudimos marcarla como predeterminada.`;
  return base + (card.isDefault ? ". Es tu predeterminada." : ".");
}

export function deletedCardToast(card: SavedCard): string {
  return `Eliminaste ${card.alias ? `"${card.alias}"` : `tu ${cardTitle(card)}`}.`;
}

export function defaultCardToast(card: SavedCard): string {
  return `Ahora pagás con ${cardLabel(card)} por defecto.`;
}

export function renamedCardToast(card: SavedCard): string {
  return card.alias ? `Ahora se llama "${card.alias}".` : `Le sacaste el nombre a tu ${cardTitle(card)}.`;
}

/** Iniciales del banco para el recuadro cuando no hay logo ("Banco Galicia" → "BG"). */
export function bankInitials(issuerName: string): string {
  return issuerName
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const TOKEN_FAILURE_MESSAGES: Record<CardTokenFailure["reason"], string> = {
  invalid_number: "El número de la tarjeta no es válido. Revisalo y probá de nuevo.",
  invalid_expiration: "La fecha de vencimiento no es válida o la tarjeta está vencida.",
  invalid_security_code: "El código de seguridad no es válido. Revisalo en el dorso de la tarjeta.",
  invalid_holder: "Revisá el nombre del titular, tal como figura en la tarjeta.",
  invalid_document: "Revisá el número de documento del titular.",
  network: "No pudimos conectarnos con Mercado Pago. Revisá tu conexión y probá de nuevo.",
  unknown: "No pudimos guardar la tarjeta. Revisá los datos o probá con otra.",
};

const FIELD_STEP: Record<NonNullable<CardTokenFailure["field"]>, 1 | 2 | 3> = {
  number: 1,
  expiration: 2,
  security_code: 2,
  holder: 3,
  document: 3,
};

/**
 * Motivo en lenguaje claro de un alta fallida (AC4) y el paso del wizard donde está el dato a
 * corregir (`null`: se queda donde está). Cubre el rechazo de MP al tokenizar y los errores
 * del backend al guardar.
 */
export function cardSaveError(err: unknown): { message: string; step: 1 | 2 | 3 | null } {
  if (err instanceof CardTokenError) {
    return {
      message: TOKEN_FAILURE_MESSAGES[err.failure.reason],
      step: err.failure.field ? FIELD_STEP[err.failure.field] : null,
    };
  }
  return { message: friendlyErrorMessage(err, TOKEN_FAILURE_MESSAGES.unknown), step: null };
}
