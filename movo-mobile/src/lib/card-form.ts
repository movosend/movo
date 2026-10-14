import { cardBrandFromNumber } from "./card-brand";
import type { CardBinInfo } from "./mp-card-tokenizer";

/**
 * Reglas del formulario de alta de tarjeta (MOVO-101), las del prototipo con dos ajustes
 * contra la API real de MP: el `card_number.length` que informa MP para un BIN es el largo
 * MÁXIMO (Visa responde 19 aunque sus tarjetas sean de 16), así que el número vale entre el
 * mínimo de la marca y ese tope y además tiene que pasar Luhn (`validation: "standard"`).
 * El código toma el largo de MP (si no, 4 en Amex y 3 en el resto). Vencimiento no pasado,
 * titular de 3+ letras y DNI de 7 u 8 dígitos.
 */
export interface CardFormValues {
  /** Solo dígitos. */
  num: string;
  /** Solo dígitos, MMAA. */
  exp: string;
  cvv: string;
  name: string;
  /** Solo dígitos. */
  dni: string;
}

export interface CardFormValidity {
  num: boolean;
  exp: boolean;
  cvv: boolean;
  name: boolean;
  dni: boolean;
}

export const CARD_HOLDER_MAX_LENGTH = 26;
export const CARD_DNI_MAX_LENGTH = 8;

function isAmex(num: string): boolean {
  return cardBrandFromNumber(num) === "amex";
}

/** Largo mínimo por marca: 15 en Amex, 16 en el resto (las Visa de 13 ya no se emiten). */
export function minNumberLength(num: string): number {
  return isAmex(num) ? 15 : 16;
}

/** Tope del número: el que informa MP para el BIN, o el mínimo de la marca. */
export function maxNumberLength(num: string, bin: CardBinInfo | null): number {
  return Math.max(bin?.cardNumberLength ?? 0, minNumberLength(num));
}

/** Dígito verificador de Luhn, el que MP llama validación "standard". */
export function passesLuhn(num: string): boolean {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let digit = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return num.length > 0 && sum % 10 === 0;
}

export function expectedCvvLength(num: string, bin: CardBinInfo | null): number {
  return bin?.securityCodeLength ?? (isAmex(num) ? 4 : 3);
}

/** MMAA válido y no vencido: la tarjeta vale hasta el último día del mes. */
export function isExpiryValid(exp: string, now: Date = new Date()): boolean {
  if (exp.length !== 4) return false;
  const month = Number(exp.slice(0, 2));
  const year = 2000 + Number(exp.slice(2));
  if (month < 1 || month > 12) return false;
  const nowYear = now.getFullYear();
  return year > nowYear || (year === nowYear && month >= now.getMonth() + 1);
}

export function validateCardForm(
  values: CardFormValues,
  bin: CardBinInfo | null,
  now: Date = new Date(),
): CardFormValidity {
  return {
    num:
      values.num.length >= minNumberLength(values.num) &&
      values.num.length <= maxNumberLength(values.num, bin) &&
      passesLuhn(values.num),
    exp: isExpiryValid(values.exp, now),
    cvv: values.cvv.length === expectedCvvLength(values.num, bin),
    name: values.name.trim().length >= 3,
    dni: values.dni.length >= 7,
  };
}

export function isStepValid(step: 1 | 2 | 3, validity: CardFormValidity): boolean {
  if (step === 1) return validity.num;
  if (step === 2) return validity.exp && validity.cvv;
  return validity.name && validity.dni;
}

export function onlyDigits(value: string, max: number): string {
  return value.replace(/\D/g, "").slice(0, max);
}

/** Letras (con tildes), apóstrofo y espacios, hasta 26: lo que entra en el plástico. */
export function sanitizeHolderName(value: string): string {
  return value.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñü' ]/g, "").slice(0, CARD_HOLDER_MAX_LENGTH);
}

/** "4517 6506 1234 9921". */
export function formatCardNumberInput(num: string): string {
  return num.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** "03/31". */
export function formatExpiryInput(exp: string): string {
  return exp.length > 2 ? `${exp.slice(0, 2)}/${exp.slice(2)}` : exp;
}

/** "36.789.012". */
export function formatDniInput(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
