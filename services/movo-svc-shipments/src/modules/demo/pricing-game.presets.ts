import { QuoteRequest } from "@movo/shared";

/**
 * Paquetes del juego de precios de la feria. Peso y medidas se definen acá y no en el
 * front: el visitante elige una tarjeta ("Caja chica"), nunca carga números, y así la
 * cotización usa siempre los mismos datos que después se guardan en la partida.
 */
export const PRICING_GAME_PRESETS = {
  letter: { packageType: "letter_document", weightKg: 0.5, lengthCm: 30, widthCm: 22, heightCm: 1 },
  small: { packageType: "standard_package", weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 15 },
  medium: { packageType: "standard_package", weightKg: 8, lengthCm: 50, widthCm: 40, heightCm: 30 },
  fragile: { packageType: "fragile_item", weightKg: 3, lengthCm: 30, widthCm: 30, heightCm: 30 },
} as const satisfies Record<
  string,
  Pick<QuoteRequest, "packageType" | "weightKg" | "lengthCm" | "widthCm" | "heightCm">
>;

export type PricingGamePreset = keyof typeof PRICING_GAME_PRESETS;

export const PRICING_GAME_PRESET_IDS = Object.keys(PRICING_GAME_PRESETS) as PricingGamePreset[];
